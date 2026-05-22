require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const FOOD_API_URL = 'https://sinamon.dothome.co.kr/food/?json';
const MELON_API_URL = 'https://sinamon.dothome.co.kr/melon/';
const KOREA_TIMEZONE = 'Asia/Seoul';
const MENU_SEND_HOURS = [7, 11, 17];

// 봇 클라이언트 초기화
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

function getTodayMenuKey() {
    const parts = new Intl.DateTimeFormat('ko-KR', {
        timeZone: KOREA_TIMEZONE,
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date());

    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;

    if (!month || !day) {
        throw new Error('오늘 날짜를 계산할 수 없습니다.');
    }

    return `${month}.${day}`;
}

function getKoreaDateTimeParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: KOREA_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date);

    const getPart = (type) => parts.find((part) => part.type === type)?.value;

    const year = Number(getPart('year'));
    const month = Number(getPart('month'));
    const day = Number(getPart('day'));
    const hour = Number(getPart('hour'));
    const minute = Number(getPart('minute'));
    const second = Number(getPart('second'));

    if ([year, month, day, hour, minute, second].some(Number.isNaN)) {
        throw new Error('한국 시간 정보를 계산할 수 없습니다.');
    }

    return { year, month, day, hour, minute, second };
}

function getNextMenuSendDelay(now = new Date()) {
    const koreaNow = getKoreaDateTimeParts(now);
    const currentTotalSeconds = (koreaNow.hour * 60 * 60) + (koreaNow.minute * 60) + koreaNow.second;

    for (const hour of MENU_SEND_HOURS) {
        const targetTotalSeconds = hour * 60 * 60;

        if (currentTotalSeconds < targetTotalSeconds) {
            return (targetTotalSeconds - currentTotalSeconds) * 1000;
        }
    }

    const tomorrowFirstSendSeconds = (24 * 60 * 60) - currentTotalSeconds + (MENU_SEND_HOURS[0] * 60 * 60);
    return tomorrowFirstSendSeconds * 1000;
}

function formatNextMenuSendTime(now = new Date()) {
    const nextSendAt = new Date(now.getTime() + getNextMenuSendDelay(now));

    return new Intl.DateTimeFormat('ko-KR', {
        timeZone: KOREA_TIMEZONE,
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).format(nextSendAt);
}

// 식단 데이터를 가져오는 함수
async function fetchMenu() {
    try {
        const response = await fetch(FOOD_API_URL);
        if (!response.ok) throw new Error('API 요청 실패');
        const data = await response.json();

        if (!Array.isArray(data)) {
            throw new Error('식단 데이터 형식이 올바르지 않습니다.');
        }

        const todayStr = getTodayMenuKey();

        // 오늘 날짜에 해당하는 데이터 찾기
        const todayMenu = data.find((item) => item.date === todayStr);
        return todayMenu;
    } catch (error) {
        console.error('식단 가져오기 오류:', error);
        return null;
    }
}

async function fetchNmixxRanks() {
    try {
        const response = await fetch(MELON_API_URL);
        if (!response.ok) throw new Error('API 요청 실패');
        const data = await response.json();

        if (!Array.isArray(data)) {
            throw new Error('멜론 데이터 형식이 올바르지 않습니다.');
        }

        return data.filter((item) => item.artist === 'NMIXX');
    } catch (error) {
        console.error('멜론 순위 가져오기 오류:', error);
        return null;
    }
}

function buildMenuEmbed(todayMenu) {
    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle(`🍴 오늘의 식단 (${todayMenu.date} ${todayMenu.day}요일)`)
        .setTimestamp();

    for (const [mealName, menuItems] of Object.entries(todayMenu.menus ?? {})) {
        const menuText = Array.isArray(menuItems) ? menuItems.join('\n') : String(menuItems);
        embed.addFields({ name: mealName, value: menuText || '정보 없음' });
    }

    return embed;
}

function buildNmixxEmbed(songs) {
    const description = songs
        .map((song) => `${song.rank}위 - ${song.songs}`)
        .join('\n');

    const embed = new EmbedBuilder()
        .setColor(0x1DB954)
        .setTitle('🎵 NMIXX 멜론 순위')
        .setDescription(description || '순위 정보가 없습니다.')
        .setTimestamp();

    return embed;
}

async function sendTodayMenuToChannel() {
    const channelId = process.env.DISCORD_CHANNEL_ID;

    if (!channelId) {
        console.log('DISCORD_CHANNEL_ID가 없어 자동 식단 전송을 건너뜁니다.');
        return;
    }

    const todayMenu = await fetchMenu();
    if (!todayMenu) {
        console.error('자동 식단 전송 실패: 오늘 식단 데이터를 찾지 못했습니다.');
        return;
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) {
        throw new Error('DISCORD_CHANNEL_ID가 텍스트 채널이 아닙니다.');
    }

    await channel.send({ embeds: [buildMenuEmbed(todayMenu)] });
    console.log(`오늘 식단을 채널(${channelId})에 전송했습니다.`);
}

function scheduleNextMenuSend() {
    const delay = getNextMenuSendDelay();
    const nextSendTime = formatNextMenuSendTime();

    console.log(`다음 식단 자동 전송 예약: ${nextSendTime} (${KOREA_TIMEZONE})`);

    setTimeout(async () => {
        try {
            await sendTodayMenuToChannel();
        } catch (error) {
            console.error('예약된 식단 전송 오류:', error);
        } finally {
            scheduleNextMenuSend();
        }
    }, delay);
}

// 봇이 준비되었을 때 실행
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log('봇이 온라인 상태입니다.');
    scheduleNextMenuSend();
});

// 메시지 수신 시 실행
client.on('messageCreate', async (message) => {
    // 봇이 보낸 메시지거나 접두사(!)로 시작하지 않으면 무시
    if (message.author.bot || !message.content.startsWith('!')) return;

    const command = message.content.slice(1).toLowerCase();

    if (command === 'ping') {
        message.reply('🏓 Pong!');
    }

    if (command === 'hello') {
        message.reply(`안녕하세요, ${message.author.username}님!`);
    }

    if (command === '식단' || command === 'menu' || command === '오늘식단') {
        const todayMenu = await fetchMenu();

        if (!todayMenu) {
            return message.reply('오늘의 식단 정보를 가져올 수 없습니다. (데이터가 없거나 오류 발생)');
        }

        message.reply({ embeds: [buildMenuEmbed(todayMenu)] });
    }

    if (command === '엔믹스' || command === 'nmixx') {
        const songs = await fetchNmixxRanks();

        if (songs === null) {
            return message.reply('NMIXX 멜론 순위를 가져올 수 없습니다. (오류 발생)');
        }

        if (songs.length === 0) {
            return message.reply('현재 멜론 JSON에 NMIXX 곡이 없습니다.');
        }

        message.reply({ embeds: [buildNmixxEmbed(songs)] });
    }
});

// 봇 로그인
client.login(process.env.DISCORD_TOKEN);
