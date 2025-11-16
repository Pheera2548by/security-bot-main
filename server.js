require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');

// Line Config
const config = {
    channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.CHANNEL_SECRET
};

const client = new line.Client(config);

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Webhook สำหรับรับข้อความจาก Line
app.post('/webhook', (req, res) => {
    console.log('✅ Webhook received');
    res.status(200).send('OK');
});

// API สำหรับรับรายงานจาก LIFF
app.post('/api/report', async (req, res) => {
    console.log('📝 API Report received:', req.body);
    
    try {
        const { userId, displayName, pointId } = req.body;
        
        if (!userId || !displayName || !pointId) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required fields' 
            });
        }
        
        // ใช้ mock data
        const reportId = Math.floor(1000 + Math.random() * 9000);
        
        // 🔥 ส่งแจ้งเตือนไปยัง Admin ถ้ามี ADMIN_USER_ID
        if (process.env.ADMIN_USER_ID && process.env.CHANNEL_ACCESS_TOKEN) {
            try {
                console.log('📤 Attempting to send LINE message...');
                await client.pushMessage(process.env.ADMIN_USER_ID, {
                    type: 'text',
                    text: `🚨 รายงานใหม่!\n👤 คุณ${displayName}\n📍 จุดที่ ${pointId}\n📝 รหัส: #${reportId}\n\nพิมพ์ "เรียบร้อย" เพื่อแจ้งลูกค้า`
                });
                console.log('✅ LINE message sent successfully');
            } catch (pushError) {
                console.error('❌ LINE push message error:', pushError.message);
            }
        } else {
            console.log('⚠️ ADMIN_USER_ID or CHANNEL_ACCESS_TOKEN not set');
        }
        
        res.json({ 
            success: true, 
            reportId,
            message: 'รายงานสำเร็จ' 
        });
        
    } catch (error) {
        console.error('Report error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error'
        });
    }
});

// Health Check
app.get('/', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Security Report Bot is running',
        hasChannelToken: !!process.env.CHANNEL_ACCESS_TOKEN,
        hasAdminUserId: !!process.env.ADMIN_USER_ID,
        timestamp: new Date().toISOString()
    });
});

// Start Server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log('🚀 Server started on port', PORT);
    console.log('✅ Channel Token:', process.env.CHANNEL_ACCESS_TOKEN ? 'Set' : 'Not set');
    console.log('✅ Admin User ID:', process.env.ADMIN_USER_ID ? 'Set' : 'Not set');
});