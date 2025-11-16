require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const { Pool } = require('pg');

// Line Config
const config = {
    channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.CHANNEL_SECRET
};
const client = new line.Client(config);

// Database Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Webhook สำหรับรับข้อความจาก Line
app.post('/webhook', line.middleware(config), (req, res) => {
    res.status(200).json({ status: 'OK' });
    
    const events = req.body.events || [];
    events.forEach(event => {
        handleEvent(event).catch(err => {
            console.error('Event error:', err);
        });
    });
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
        
        // ใช้ mock data ชั่วคราว (ลบบรรทัดนี้เมื่อ database ทำงานได้)
        const reportId = Math.floor(1000 + Math.random() * 9000);
        console.log('✅ Report saved (mock):', reportId);
        
        // ส่งแจ้งเตือนไปยัง Admin
        if (process.env.ADMIN_USER_ID) {
            try {
                await client.pushMessage(process.env.ADMIN_USER_ID, {
                    type: 'text',
                    text: `🚨 รายงานใหม่!\n👤 คุณ${displayName}\n📍 จุดที่ ${pointId}\n📝 รหัส: #${reportId}`
                });
            } catch (pushError) {
                console.error('Push message error:', pushError);
            }
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

// ฟังก์ชันจัดการ Event
async function handleEvent(event) {
    try {
        if (event.type === 'message' && event.message.type === 'text') {
            const messageText = event.message.text.trim().toLowerCase();
            
            if (messageText === 'รายงาน') {
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: '📊 ระบบรายงานความปลอดภัย\n\nใช้ "เรียบร้อย" เพื่อยืนยันการแก้ไข'
                });
            }
        }
        
        if (event.type === 'follow') {
            await client.replyMessage(event.replyToken, {
                type: 'text',
                text: '👋 สวัสดี! บอทรายงานความปลอดภัย'
            });
        }
    } catch (error) {
        console.error('Handle event error:', error);
    }
}

// Health Check
app.get('/', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Security Report Bot is running'
    });
});

// Start Server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log('🚀 Server started on port', PORT);
});