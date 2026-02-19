import { addBooking, getBookings, removeBooking, setBookings } from './store.js';

// Helper to parse date string (DD-MM or DD/MM) and time range
function parseBooking(bookingStr) {
    const [datePart, timePart] = bookingStr.split(' ');
    // Handle DD-MM or DD/MM
    const [day, month] = datePart.split(/[-/]/).map(Number);

    // Get year - basic logic: if month is earlier than current month, assume next year? 
    // For MVP, allow current year. A more robust system would need full years.
    const now = new Date();
    let year = now.getFullYear();

    // Create date object for sorting
    // timePart format: HH:MM-HH:MM
    const [startTime, endTime] = timePart.split('-');
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);

    const dateObj = new Date(year, month - 1, day, startHour, startMinute);
    const endDateTime = new Date(year, month - 1, day, endHour, endMinute);

    // Get Day Name
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = days[dateObj.getDay()];

    return {
        original: bookingStr,
        dateObj,
        endDateTime,
        dayName,
        dateDisplay: `${day}/${month}`, // Keep strictly D/M as requested
        timeRange: `${startTime} - ${endTime}`
    };
}

// Helper to generate the booking list text and mentions
async function generateBookingList(remoteJid) {
    const rawBookings = await getBookings(remoteJid);
    if (rawBookings.length === 0) {
        return { text: 'No bookings found.', mentions: [] };
    }

    const now = new Date();

    // Parse all bookings first to check times
    const allParsed = rawBookings.map((b, i) => ({
        ...b,
        ...parseBooking(b.booking),
        originalIndex: i // Keep track of original index if needed (though we rewrite everything)
    }));

    // Filter to keep only future bookings
    const futureBookings = allParsed.filter(b => b.endDateTime > now);

    // If we have fewer bookings than we started with, it means some were passed.
    // We should prune them from the store.
    if (futureBookings.length < rawBookings.length) {
        // Construct array of original raw booking objects to save back
        const newStoreState = futureBookings.map(b => ({
            booking: b.booking,
            bookerJid: b.bookerJid,
            created_at: b.created_at
        }));
        await setBookings(remoteJid, newStoreState);
    }

    if (futureBookings.length === 0) {
        return { text: 'No upcoming bookings found.', mentions: [] };
    }

    // Sort the future bookings for display
    futureBookings.sort((a, b) => a.dateObj - b.dateObj);

    // Assign display indices (1, 2, 3...)
    futureBookings.forEach((b, i) => b.index = i + 1);

    // Group by Date for display
    const grouped = {};
    futureBookings.forEach(pb => {
        const key = `${pb.dayName} ${pb.dateDisplay}`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(pb);
    });

    // Format Output
    let listText = '';
    const mentions = [];

    for (const [header, items] of Object.entries(grouped)) {
        listText += `${header}\n`;
        items.forEach(item => {
            // Display: TimeRange @User [ID: Index]
            let line = `${item.timeRange}`;
            if (item.bookerJid) {
                line += ` @${item.bookerJid.split('@')[0]}`;
                mentions.push(item.bookerJid);
            }
            line += ` (id: ${item.index})`;
            listText += `${line}\n`;
        });
        listText += '\n';
    }

    return { text: listText.trim(), mentions };
}

const COMMANDS = {
    'ping': {
        description: 'Check bot connectivity',
        usage: '/ping',
        handler: async (sock, msg, args) => {
            await sock.sendMessage(msg.key.remoteJid, { text: 'Pong.' }, { quoted: msg });
        }
    },
    'book': {
        description: 'Add a new booking',
        usage: '/book DD/MM HH:MM-HH:MM',
        handler: async (sock, msg, args) => {
            const remoteJid = msg.key.remoteJid;
            const reply = async (text, mentions) => sock.sendMessage(remoteJid, { text, mentions }, { quoted: msg });

            // Regex for DD-MM or DD/MM HH:MM-HH:MM
            // Example: 25-12 10:00-12:00 or 19/2 13:00-14:00
            // Allow single digit days/months too
            const dateRegex = /^(\d{1,2}[-/]\d{1,2})\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/;
            const match = args.trim().match(dateRegex);

            if (!match) {
                await reply(`Usage: ${COMMANDS['book'].usage}\nExample: /book 19/2 13:00-14:00`);
                return;
            }

            const [_, dateStr, startTime, endTime] = match;
            // Standardize to usage format for storage
            const [d, m] = dateStr.split(/[-/]/);
            const normalizedDate = `${d}/${m}`;

            const bookingEntry = `${normalizedDate} ${startTime}-${endTime}`;

            // Validate that the booking is in the future
            const { dateObj } = parseBooking(bookingEntry);
            if (dateObj < new Date()) {
                await reply('Error: You cannot book a time in the past.');
                return;
            }

            const bookerJid = msg.key.participant || msg.key.remoteJid;

            await addBooking(remoteJid, bookingEntry, bookerJid);

            // Generate updated list
            const { text: listText, mentions } = await generateBookingList(remoteJid);
            await reply(`Booking confirmed: ${bookingEntry}\n\n${listText}`, mentions);
        }
    },
    'list': {
        description: 'List all your bookings',
        usage: '/list',
        handler: async (sock, msg, args) => {
            const remoteJid = msg.key.remoteJid;
            const reply = async (text, mentions) => sock.sendMessage(remoteJid, { text, mentions }, { quoted: msg });

            const { text, mentions } = await generateBookingList(remoteJid);
            await reply(text, mentions);
        }
    },
    'cancel': {
        description: 'Cancel a booking by ID',
        usage: '/cancel <id>',
        handler: async (sock, msg, args) => {
            const remoteJid = msg.key.remoteJid;
            const reply = async (text, mentions) => sock.sendMessage(remoteJid, { text, mentions }, { quoted: msg });

            const index = parseInt(args.trim(), 10);

            if (isNaN(index)) {
                await reply(`Usage: ${COMMANDS['cancel'].usage}\nCheck IDs with /list.`);
                return;
            }

            const removed = await removeBooking(remoteJid, index);
            if (removed) {
                // Generate updated list
                const { text: listText, mentions } = await generateBookingList(remoteJid);
                await reply(`Booking removed: ${removed.booking}\n\n${listText}`, mentions);
            } else {
                await reply(`Booking ID #${index} not found.`);
            }
        }
    },
    'help': {
        description: 'Show this help message',
        usage: '/help',
        handler: async (sock, msg, args) => {
            const remoteJid = msg.key.remoteJid;
            let helpText = 'MusicSoc Booking Bot\n\n';

            for (const [cmd, def] of Object.entries(COMMANDS)) {
                helpText += `/${cmd}:\n\n`;
                helpText += `${def.description}\n`;
                helpText += `Usage: ${def.usage}\n\n`;
            }

            await sock.sendMessage(remoteJid, { text: helpText }, { quoted: msg });
        }
    }
};

export async function handleCommand(sock, msg, text) {
    if (!text.startsWith('/')) return;

    const [cmdName, ...argsArray] = text.slice(1).split(/\s+/);
    const command = COMMANDS[cmdName.toLowerCase()];
    const args = argsArray.join(' ');

    if (command) {
        try {
            await command.handler(sock, msg, args);
        } catch (error) {
            console.error(error);
            await sock.sendMessage(msg.key.remoteJid, { text: 'An error occurred while processing your command.' }, { quoted: msg });
        }
    }
}
