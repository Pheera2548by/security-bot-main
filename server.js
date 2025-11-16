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
    
    try {
        const events = req.body.events || [];
        console.log(`📋 Processing ${events.length} events`);
        
        events.forEach(event => {
            handleEvent(event).catch(err => {
                console.error('Event error:', err);
            });
        });
    } catch (error) {
        console.error('Webhook error:', error);
    }
});

// ฟังก์ชันจัดการ Event
async function handleEvent(event) {
    try {
        console.log('🔹 Handling event:', event.type);
        
        if (event.type === 'message' && event.message.type === 'text') {
            const messageText = event.message.text.trim().toLowerCase();
            
            // ถ้ามีคำว่า "เรียบร้อย"
            if (messageText.includes('เรียบร้อย')) {
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: '✅ ยืนยันการแก้ไขเรียบร้อยแล้ว!\n\nระบบจะแจ้งเตือนให้ลูกค้าทราบโดยอัตโนมัติ'
                });
            }
            
            // คำสั่งตรวจสอบสถานะ
            if (messageText === 'รายงาน' || messageText === 'status') {
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: '📊 ระบบรายงานความปลอดภัย\n\nมีรายงานใหม่เข้ามาแล้ว!\nพิมพ์ "เรียบร้อย" เพื่อยืนยันการแก้ไข'
                });
            }
            
            // คำสั่ง help
            if (messageText === 'help' || messageText === 'ช่วยเหลือ') {
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: '💡 คำสั่งที่ใช้ได้:\n• "รายงาน" - ดูสถานะ\n• "เรียบร้อย" - ยืนยันการแก้ไข\n• "help" - แสดงคำสั่ง'
                });
            }
        }
        
        // เมื่อมีคนเพิ่มเพื่อน
        if (event.type === 'follow') {
            await client.replyMessage(event.replyToken, {
                type: 'text',
                text: '👋 สวัสดี! บอทรายงานความปลอดภัย\n\nพิมพ์ "help" เพื่อดูคำสั่งทั้งหมด'
            });
        }
        
    } catch (error) {
        console.error('❌ Handle event error:', error);
    }
}

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
        
        const reportId = Math.floor(1000 + Math.random() * 9000);
        
        // ส่งแจ้งเตือนไปยัง Admin
        if (process.env.ADMIN_USER_ID) {
            try {
                await client.pushMessage(process.env.ADMIN_USER_ID, {
                    type: 'text',
                    text: `🚨 รายงานใหม่!\n👤 คุณ${displayName}\n📍 จุดที่ ${pointId}\n📝 รหัส: #${reportId}\n\nพิมพ์ "เรียบร้อย" เพื่อแจ้งลูกค้า`
                });
            } catch (pushError) {
                console.error('❌ Push message error:', pushError.message);
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

// Health Check
app.get('/', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Security Report Bot is running',
        timestamp: new Date().toISOString()
    });
});

// Start Server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log('🚀 Server started on port', PORT);
});