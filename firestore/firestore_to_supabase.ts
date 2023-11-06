import * as fs from "fs";
import * as admin from "firebase-admin";
import { Client, QueryResult } from "pg";
import { recipes } from "./recipe";
import { v4 } from "uuid";
import { getRecipeSummaryCompletion, getEmbedding } from "./add_imbedings";

/////////////////////////init/////////////////////////

const serviceAccount = require("./firebase-service.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`,
});

const pgCreds = JSON.parse(fs.readFileSync("./supabase-service.json", "utf8"));

const client = new Client({
  user: pgCreds.user,
  host: pgCreds.host,
  database: pgCreds.database,
  password: pgCreds.password,
  port: pgCreds.port,
});

async function main() {
  await client.connect();

  for (const recipe of recipes.slice(11, 30)) {
    _addRecipe(recipe);
    await new Promise((resolve) => setTimeout(resolve, 7000));
  }
  // await Promise.all(recipes.slice(0, 5).map(_addRecipe));
}

main();

/////////////////////////adding recipe/////////////////////////
async function _addRecipe(recipe: Partial<Recipe>) {
  const MEAL_TYPE_MAPPING: { [key: string]: string } = {
    "0": "breakfast",
    "1": "lunch",
    "2": "dinner",
    "3": "snacks",
    "4": "smoothies",
    "5": "sheetPan",
    "6": "crockPot",
  };

  recipe.id = v4();
  const type = MEAL_TYPE_MAPPING[recipe!.mealType!];

  if (!type) {
    console.log(recipe.id);
    throw new Error(`Unknown type ${recipe.mealType}`);
  }

  const { nutritionNotes, proteinQuantity, carbsQuantity, fatQuantity } =
    getNutritionDetails(recipe.nutrition!);

  const trimmed = recipe.calories
    ?.split(",")
    .map((calory) => calory.trim().toUpperCase())
    .filter((element) => element !== "");

  const {
    serving,
    displayAt,
    nutrition,
    mealType,
    ingredients,
    calories,
    ...remainingRecipe
  } = recipe;

  const sbRecipe = {
    ...remainingRecipe,
    dietary_preferences: trimmed,
    type,
    created_at: recipe.created_at && convertToTimestampZ(recipe.created_at),
    nutrition_notes: nutritionNotes,
    protein_quantity: proteinQuantity,
    carbs_quantity: carbsQuantity,
    fat_quantity: fatQuantity,
  };

  sbRecipe.embedding = await createRecipeEmbedding(
    recipe,
    type,
    ingredients ?? []
  );
  sbRecipe.summary = recipe.summary;

  await runSQL(_createSql("recipe", sbRecipe));
  if (ingredients == null) return;
  await Promise.all(
    ingredients!.map(
      async (ingredient) =>
        await addIngredient({ ingredient, recipeId: sbRecipe.id! })
    )
  );
}

async function addIngredient({
  ingredient,
  recipeId,
}: {
  ingredient: {
    unit: string;
    quantity: string;
    name: string;
    category: {
      name: string;
      id: string;
    };
  };
  recipeId: string;
}) {
  const escapedName = ingredient.name.replace(/'/g, "''");

  let res = await runSQL(`
    SELECT id
    FROM ingredient
    WHERE name LIKE '%${escapedName}%'
    LIMIT 1;
  `);

  let result = res as QueryResult;

  const id: string | undefined =
    result != null && result.rowCount ? result.rows[0].id : undefined;

  const sbIngredient: sbRecipe = {
    id: v4(),
    name: ingredient.name,
    category: ingredient.category.id,
    unit: ingredient.unit,
  };

  if (ingredient.category == null || ingredient.category.id.trim() === "")
    delete sbIngredient.category;

  if (!id) await runSQL(_createSql("ingredient", sbIngredient));

  const ingredient_recipe = {
    quantity: ingredient.quantity,
    recipe_id: recipeId,
    ingredient_id: id ?? sbIngredient.id,
  };

  await runSQL(_createSql("recipe_ingredient", ingredient_recipe));
}

/////////////////////////SQL/////////////////////////

async function runSQL(sql: string) {
  return new Promise((resolve, reject): any => {
    // fs.writeFileSync(`temp.sql`, sql, 'utf-8');
    client.query(sql, (err, res) => {
      if (err) {
        console.log("runSQL error:", err);
        console.log("sql was: " + sql);
        quit();
        reject(err);
      } else {
        resolve(res);
      }
    });
  });
}

function _createSql(tableName: string, object: { [key: string]: any }) {
  let fieldSql = `(`;
  let sql = `(`;

  for (const field in object) {
    let value = object[field];
    const prefix = sql.length > 1 ? "," : "";
    sql += prefix;
    fieldSql += `${prefix}${field}`;

    if (typeof value === "object" && !Array.isArray(value)) {
      value = JSON.stringify(value);
    }

    if (typeof value === "undefined") {
      sql += `null`;
    } else if (
      typeof value !== "bigint" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      if (typeof value == "object" && Array.isArray(value)) {
        if (field === "embedding") {
          console.log("this is embedding");
          let embedding = value as number[];
          sql += `'[${embedding}]'`;
          continue;
        }

        let array = value as string[];

        const arrayType =
          field === "phase"
            ? "menstrual_phase"
            : field === "dietary_preferences"
            ? "dietary_preference"
            : "text";

        if (array.length) {
          const stringified = array
            .map((element) =>
              typeof element === "string"
                ? `'${element.replace(/'/g, "''")}'`
                : `'${String(element).replace(/'/g, "''")}'`
            )
            .join(",");

          const correctValue = `ARRAY[${stringified}]::${arrayType}[]`;

          sql += `${correctValue}`;
        } else {
          sql += `ARRAY[]::${arrayType}[]`;
        }
      } else {
        if (field == "time") {
          const timeInSeconds = durationToSeconds(value);
          sql += `'${timeInSeconds}'`;
        } else sql += `'${value.replace(/'/g, "''")}'`;
      }
    } else {
      sql += `${value}`;
    }
  }

  fieldSql += ")";
  sql += ")";

  return `INSERT INTO ${tableName} ${fieldSql} VALUES ${sql};`;
}
/////////////////////////Helpers/////////////////////////
async function createRecipeEmbedding(
  recipe: Partial<Recipe>,
  type: string,
  ingredients: { name: string }[]
): Promise<number[]> {
  const stringifiedIngredients = `${ingredients!.map(
    (ingredient) => ingredient.name + ","
  )}`;

  const prompt = `Recipe name: ${recipe.name}.

Recipe type: ${type},

Recipe dietary preference: ${recipe.calories},

Recipe ingredients: ${stringifiedIngredients}.
`;

  recipe.summary = await getRecipeSummaryCompletion(prompt);

  console.log(recipe.summary);

  const embeddings = await getEmbedding(recipe.summary!.toLowerCase(), true);

  return embeddings;
}

function getNutritionDetails(nutrition: string) {
  const matches = extractNumbers(nutrition);

  return {
    nutritionNotes: nutrition.includes(":")
      ? nutrition.split(":")[0].trim()
      : "",
    proteinQuantity: matches[0],
    carbsQuantity: matches[1],
    fatQuantity: matches[2],
  };
}

function convertToTimestampZ(obj: {
  _seconds: number;
  _nanoseconds: number;
}): string {
  const milliseconds =
    obj._seconds * 1000 + Math.floor(obj._nanoseconds / 1000000);
  const timestampZ = new Date(milliseconds).toISOString();
  return timestampZ;
}

function extractNumbers(input: string): number[] {
  const matches = input.match(/\d+/g);
  if (!matches) return [];

  return matches.slice(0, 4).map((str) => parseInt(str));
}

function durationToSeconds(duration: string): number {
  const regex = /(\d+)(?:\s*-\s*(\d+))?\s*(hours?|mins?|minutes?)/gi;
  let matches: string[] | null;
  let totalSeconds = 0;

  while ((matches = regex.exec(duration)) !== null) {
    let value1 = parseInt(matches[1], 10);
    let value2 = matches[2] ? parseInt(matches[2], 10) : value1;

    let multiplier = 1;
    switch (matches[3].toLowerCase()) {
      case "hours":
      case "hour":
        multiplier = 3600;
        break;
      case "mins":
      case "min":
      case "minutes":
      case "minute":
        multiplier = 60;
        break;
    }

    let avgValue = Math.round((value1 + value2) / 2);
    totalSeconds += avgValue * multiplier;
  }

  return totalSeconds;
}

/////////////////////////interfaces/////////////////////////

interface Recipe {
  phase: string[];
  image: string;
  mealType: string;
  created_at: {
    _seconds: number;
    _nanoseconds: number;
  };
  weight: number;
  calories: string;
  serving: string;
  tags: string[];
  dressings: {
    unit: string;
    quantity: string;
    name: string;
    category: {
      name: string;
      id: string;
    };
  }[];
  nutrition: string;
  nutrition_notes?: string;
  protein_quantity?: number;
  carbs_quantity?: number;
  fat_quantity?: number;
  displayAt: number;
  name: string;
  ingredients: {
    unit: string;
    quantity: string;
    name: string;
    category: {
      name: string;
      id: string;
    };
  }[];
  id: string;
  time: string;
  direction: string[];
  firestore_id: string;
  summary?: string;
  embedding?: number[];
}

interface sbRecipe {
  id: string;
  name: string;
  category?: string;
  unit: string;
}

function quit() {
  client.end();
  process.exit(1);
}
