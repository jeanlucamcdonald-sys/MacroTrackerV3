export function dashboardContext(profile = {}, user = null, date = new Date()) {
    const named = value => typeof value === 'string' ? value.trim() : '';
    const supplied = named(profile.displayName) || named(user?.displayName) || named(user?.email).split('@')[0] || 'there';
    const name = supplied.split(/\s+/)[0];
    const hour = date.getHours();
    const phase = hour < 5 ? 'late' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 22 ? 'evening' : 'late';
    const phrases = {
        morning: ["What's for breakfast?", 'Ready to fuel your morning?', 'Start your day with something nourishing.'],
        afternoon: ["What's fueling you today?", 'Time for lunch or a midday bite?', 'Keep your afternoon fueled.'],
        evening: ["What's for dinner?", 'What’s fueling your evening?', 'Time to log your evening meal.'],
        late: ['A late snack or wrapping up your day?', 'How did you fuel your day?', 'A final bite before you call it a day?']
    };
    // Requested default prompts lead each phase; rotate slowly without randomness on rerender.
    const index = Math.floor(date.getMinutes() / 20) % phrases[phase].length;
    return { greeting: `Welcome ${name}`, prompt: phrases[phase][index], phase };
}
