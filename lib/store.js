import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BOOKINGS_FILE = path.join(path.dirname(__dirname), 'bookings.json');

// Helper to init file if not exists
async function initStore() {
    try {
        await fs.access(BOOKINGS_FILE);
    } catch {
        await fs.writeFile(BOOKINGS_FILE, JSON.stringify({}, null, 2));
    }
}

async function getStore() {
    await initStore();
    const data = await fs.readFile(BOOKINGS_FILE, 'utf-8');
    try {
        return JSON.parse(data);
    } catch {
        return {};
    }
}

async function saveStore(data) {
    await fs.writeFile(BOOKINGS_FILE, JSON.stringify(data, null, 2));
}

export async function addBooking(userJid, bookingText, bookerJid) {
    const store = await getStore();
    if (!store[userJid]) store[userJid] = [];

    const timestamp = new Date().toISOString();
    store[userJid].push({
        booking: bookingText,
        bookerJid,
        created_at: timestamp
    });

    await saveStore(store);
    return store[userJid].length; // Return new index (1-based implied by usage context eventually, but let's stick to simple array first)
}

export async function setBookings(userJid, newBookings) {
    const store = await getStore();
    store[userJid] = newBookings;
    await saveStore(store);
}

export async function getBookings(userJid) {
    const store = await getStore();
    return store[userJid] || [];
}

export async function removeBooking(userJid, indexOneBased) {
    const store = await getStore();
    if (!store[userJid]) return false;

    const index = indexOneBased - 1; // Convert to 0-based
    if (index >= 0 && index < store[userJid].length) {
        const removed = store[userJid].splice(index, 1);
        await saveStore(store);
        return removed[0];
    }
    return null;
}
