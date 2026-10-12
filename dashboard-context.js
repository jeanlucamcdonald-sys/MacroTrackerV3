export const PROMPTS = {
    morning: ["What's for breakfast?", 'Starting strong today?', 'Ready to fuel your morning?', 'Coffee first, breakfast next?', 'A fresh day, a fresh plate.', 'What’s your morning go-to?', 'Breakfast plans looking good?', 'Make room for a nourishing start.', 'Something crunchy to start the day?', 'Your morning fuel is calling.'],
    afternoon: ["What's fueling you today?", "What's for lunch?", 'A midday bite sounds good.', 'Keep your afternoon fueled.', 'What’s on your lunch plate?', 'A little fuel for the next chapter.', 'Lunch break, anyone?', 'What’s powering your afternoon?', 'Your next meal can be a fresh start.', 'Something delicious for the midday stretch?'],
    evening: ["What's for dinner?", 'What’s fueling your evening?', 'Wrapping up today’s macros?', 'Dinner plans taking shape?', 'Time for your evening favorites.', 'A little protein with dinner?', 'What’s cooking tonight?', 'Make tonight’s meal your own.', 'Finishing the day with something nourishing?', 'Let’s see what made it onto your plate.'],
    late: ['A late snack or wrapping up your day?', 'How did you fuel your day?', 'A final bite before you call it a day?', 'Night owl, what’s on the menu?', 'Your diary will be here in the morning.'],
    lose: ["How's the cut going?", 'Small steps count on your cut.', 'Keeping your cut fueled and satisfying?', 'A filling meal can fit your plan.', 'Protein, flavor, and room to enjoy it.', 'Steady progress beats a perfect day.'],
    gain: ['Building strength, one meal at a time.', 'Fueling your next workout?', 'Fueling recovery today?', 'Give your next session some fuel.', 'What’s helping you build today?', 'A little extra fuel for your goals.'],
    maintain: ['Finding your everyday rhythm?', 'Keep your steady groove going.', 'Balance can taste good.', 'What’s your reliable go-to today?', 'Fuel for the life you’re living.', 'A satisfying plate for a steady day.'],
    playful: ['Feeling spicy?', 'Keep the momentum going.', 'Your plate, your plot twist.', 'Crunchy, cozy, or a little of both?', 'Good food deserves a spot in the diary.', 'What’s the tastiest part of today?']
};
export function dashboardContext(profile = {}, user = null, date = new Date()) {
    const named = value => typeof value === 'string' ? value.trim() : '';
    const supplied = named(profile.displayName) || named(profile.name) || named(user?.displayName) || named(user?.email).split('@')[0] || 'there';
    const name = supplied;
    const hour = date.getHours();
    const phase = hour < 4 ? 'late' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
    const goal = ({ cut: 'lose', bulk: 'gain' })[profile.goal] || (['lose', 'gain'].includes(profile.goal) ? profile.goal : 'maintain');
    const salutation = phase === 'morning' ? 'Good morning' : phase === 'afternoon' ? 'Good afternoon' : 'Good evening';
    // Stable for a local half-hour window; refreshes across dates, goals, and accounts.
    const window = Math.floor(date.getMinutes() / 30);
    const bucket = [PROMPTS[phase], PROMPTS[goal], PROMPTS.playful][(date.getDate() + hour + window) % 3];
    const identity = `${user?.uid || name}:${goal}:${date.getFullYear()}-${date.getMonth()}-${date.getDate()}:${hour}:${window}`;
    let hash = 0;
    for (const char of identity) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
    return { greeting: `${salutation}, ${name}`, prompt: bucket[hash % bucket.length], phase, goal };
}
