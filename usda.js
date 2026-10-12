const API_KEY = 'DEMO_KEY'; 
const BASE_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';

function getNutrient(nutrientsArray, nutrientId) {
    if (!nutrientsArray) return 0;
    const nutrient = nutrientsArray.find(n => n.nutrientId === nutrientId || n.nutrientNumber === nutrientId.toString());
    return nutrient ? nutrient.value : undefined; // Return exact decimal for math
}

export async function searchExternalDatabase(query, { signal } = {}) {
    try {
        // requireAllWords=true strictly forces the API to only return items matching ALL typed words
        const url = `${BASE_URL}?api_key=${API_KEY}&query=${encodeURIComponent(query)}&requireAllWords=true&pageSize=40`;
        const response = await fetch(url, { signal });
        
        if (!response.ok) {
            console.error("❌ USDA API Error:", response.status, response.statusText);
            throw new Error(`USDA lookup returned ${response.status}`);
        }
        
        const data = await response.json();
        if (!data.foods || data.foods.length === 0) return [];
        
        let normalizedResults = data.foods.map(food => {
            // USDA search nutrients are per 100g; do not assume ml-to-gram density.
            const serving = 100;
            const unit = 'g';
            const scale = 1;
            return {
                id: `usda_${food.fdcId}`,
                name: food.description,
                category: food.foodCategory || "General",
                serving: Math.round(serving), 
                unit: unit.toLowerCase(),
                cal: Math.round(getNutrient(food.foodNutrients, 1008) * scale),
                p: Math.round(getNutrient(food.foodNutrients, 1003) * scale),
                c: Math.round(getNutrient(food.foodNutrients, 1005) * scale),
                f: Math.round(getNutrient(food.foodNutrients, 1004) * scale)
            };
        }).filter(food => ['cal', 'p', 'c', 'f'].every(key => Number.isFinite(food[key]) && food[key] >= 0));

        // Relevance Engine
        const qLower = query.toLowerCase().trim();
        const queryWords = qLower.replace(/[,.-]/g, '').split(/\s+/);
        
        normalizedResults.sort((a, b) => {
            const aName = a.name.toLowerCase();
            const bName = b.name.toLowerCase();

            if (aName === qLower) return -1;
            if (bName === qLower) return 1;

            const aMatches = queryWords.filter(w => aName.includes(w)).length;
            const bMatches = queryWords.filter(w => bName.includes(w)).length;
            if (aMatches !== bMatches) return bMatches - aMatches; 

            const aStarts = aName.startsWith(queryWords[0]);
            const bStarts = bName.startsWith(queryWords[0]);
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;

            return a.name.length - b.name.length;
        });

        // Duplicate Filter
        const uniqueResults = [];
        const seenNames = new Set();
        for (const item of normalizedResults) {
            if (!seenNames.has(item.name)) {
                seenNames.add(item.name);
                uniqueResults.push(item);
            }
        }

        return uniqueResults.slice(0, 6);
        
    } catch (error) {
        if (signal?.aborted || error.name === 'AbortError') throw error;
        console.error("❌ USDA API Request Failed:", error);
        throw error;
    }
}