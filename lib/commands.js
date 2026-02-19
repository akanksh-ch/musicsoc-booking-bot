import { addBooking, getBookings, removeBooking } from './store.js';

export async function handleCommand(sock, msg, text) {
    const remoteJid = msg.key.remoteJid;

    const reply = async (content) => {
        await sock.sendMessage(remoteJid, { text: content }, { quoted: msg });
    };

    if (text === '/ping') {
        await reply('pong!');
        return;
    }

    if (text.startsWith('/book')) {
        // Regex for DD-MM HH:MM-HH:MM
        // Handling strict format first. 
        // Example: 25-12 10:00-12:00
        const args = text.replace('/book', '').trim();
        const dateRegex = /^(\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/;
        const match = args.match(dateRegex);

        if (!match) {
            await reply('Usage: /book DD-MM HH:MM-HH:MM\nExample: /book 25-12 10:00-12:00');
            return;
        }

        const [_, dateStr, startTime, endTime] = match;
        // Simple string storage as requested by "MVP"
        const bookingEntry = `${dateStr} ${startTime}-${endTime}`;

        await addBooking(remoteJid, bookingEntry);
        await reply(`✅ Booking added: ${bookingEntry}`);
        return;
    }

    if (text === '/list') {
        const bookings = await getBookings(remoteJid);
        if (bookings.length === 0) {
            await reply('You have no bookings.');
            return;
        }

        const listText = bookings.map((b, i) => `${i + 1}. ${b.booking}`).join('\n');
        await reply(`📅 *Your Bookings:*\n${listText}`);
        return;
    }

    if (text.startsWith('/cancel')) {
        const args = text.replace('/cancel', '').trim();
        const index = parseInt(args, 10);

        if (isNaN(index)) {
            await reply('Usage: /cancel <number>\nUse /list to see your booking numbers.');
            return;
        }

        const removed = await removeBooking(remoteJid, index);
        if (removed) {
            await reply(`🗑️ Booking removed: ${removed.booking}`);
        } else {
            await reply(`❌ Booking #${index} not found.`);
        }
        return;
    }
}
