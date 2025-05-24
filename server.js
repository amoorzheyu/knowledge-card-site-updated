const express = require('express');
const app = express();
app.set('trust proxy', true);
const path = require('path');
const fs = require('fs');

// ====== 初始化 cards.json ======
let cards;
try {
    cards = JSON.parse(fs.readFileSync('cards.json', 'utf-8'));
} catch (error) {
    console.error('Error reading cards.json:', error);
    process.exit(1);
}

// ====== 初始化黑名单 ======
const blacklistPath = 'blacklist.json';
let blacklist = new Set();
let requestLog = new Map(); // IP -> [timestamps]

try {
    const data = fs.readFileSync(blacklistPath, 'utf-8');
    blacklist = new Set(JSON.parse(data));
} catch (error) {
    console.warn('No blacklist found. It will be created on first abuse.');
}

// ====== 频率限制设置 ======
const RATE_LIMIT_WINDOW_MS = 2 * 1000; // 2秒
const MAX_REQUESTS_PER_WINDOW = 10;

// ====== 中间件：频率限制与黑名单拦截 ======
app.use(express.json());
app.use((req, res, next) => {
    const ip = req.ip;

    // 黑名单拦截
     if (blacklist.has(ip)) {
        return res.status(403).sendFile(path.join(__dirname, 'forbidden.html'));
    }

    const now = Date.now();
    const log = requestLog.get(ip) || [];

    // 移除超出时间窗口的记录
    const recent = log.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW_MS);
    recent.push(now);

    if (recent.length > MAX_REQUESTS_PER_WINDOW) {
        blacklist.add(ip);
        fs.writeFileSync(blacklistPath, JSON.stringify(Array.from(blacklist), null, 2));
        return res.status(429).json({ error: 'Too many requests. IP blacklisted.' });
    }

    requestLog.set(ip, recent);
    next();
});

// ====== 获取随机卡片 ======
app.post('/random-card', (req, res) => {
    const currentCardId = req.body.currentCardId;
    let randomIndex;

    if (cards.length === 0) {
        return res.status(404).json({ error: 'No cards available.' });
    }

    // 避免只剩一个卡片导致死循环
    if (cards.length === 1 || currentCardId === undefined) {
        return res.json(cards[0]);
    }

    do {
        randomIndex = Math.floor(Math.random() * cards.length);
    } while (cards[randomIndex].id === currentCardId);

    res.json(cards[randomIndex]);
});

// ====== 新增卡片 ======
app.post('/add-card', (req, res) => {
    const newContent = req.body.content;

    if (!newContent || typeof newContent !== 'string') {
        return res.status(400).json({ error: 'Invalid content input.' });
    }

    const duplicate = cards.find(card => card.content === newContent);
    if (duplicate) {
        return res.status(409).json({ error: 'Card with the same content already exists.' });
    }

    const newId = cards.length > 0 ? cards[cards.length - 1].id + 1 : 1;
    const newCard = { id: newId, content: newContent };
    cards.push(newCard);

    fs.writeFile('cards.json', JSON.stringify(cards, null, 2), (err) => {
        if (err) {
            console.error('Error writing to cards.json:', err);
            return res.status(500).json({ error: 'Failed to save the card.' });
        }

        let cardsBack = [];
        try {
            cardsBack = JSON.parse(fs.readFileSync('cards_back.json', 'utf-8'));
        } catch (error) {
            console.warn('cards_back.json not found. A new one will be created.');
        }

        cardsBack.push(newCard);
        fs.writeFile('cards_back.json', JSON.stringify(cardsBack, null, 2), (err) => {
            if (err) {
                console.error('Error writing to cards_back.json:', err);
                return res.status(500).json({ error: 'Failed to update backup.' });
            }
            res.status(201).json(newCard);
        });
    });
});

// ====== 删除最后一个卡片（不动备份） ======
app.delete('/delete-last-card', (req, res) => {
    if (cards.length === 0) {
        return res.status(404).json({ error: 'No cards to delete.' });
    }

    const deletedCard = cards.pop();

    fs.writeFile('cards.json', JSON.stringify(cards, null, 2), (err) => {
        if (err) {
            console.error('Error writing to cards.json:', err);
            return res.status(500).json({ error: 'Failed to update the card list.' });
        }
        res.json({ message: 'Last card deleted.', deletedCard });
    });
});

// ====== 管理员页面 ======
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// ====== 首页路由 ======
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ====== 启动服务器 ======
app.listen(3002, () => {
    console.log('main Server is running on http://localhost:3002');
    console.log('admin  Server is running on http://localhost:3002/admin');
});
