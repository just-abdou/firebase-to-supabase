module.exports = (collectionName, doc, recordCounters, writeRecord) => {
  for (let i = 0; i < doc.ingredients.length; i++) {
    const firestoreIngredient = doc.ingredients;

    const id = `${firestoreIngredient.name}_${i}_${doc.id}`;

    const ingredient = {
      id: id,
      name: firestoreIngredient.name,
      category: firestoreIngredient.category,
      unit: firestoreIngredient.unit,
    };

    writeRecord("ingredient", ingredient, recordCounters);

    const ingredient_recipe = {
      id: `${doc.id}_${firestoreIngredient.name}_${i}`,
      quantity: firestoreIngredient.quantity,
      recipeId: doc.id,
      ingredientId: id,
    };

    writeRecord("recipe_ingredient", ingredient_recipe, recordCounters);
  }

  const type = doc.mealType;

  delete doc.displayAt;
  delete doc.mealType;
  delete doc.ingredients;

  return { ...doc, type };
};
