require('dotenv').config();
const express = require('express');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Webhook สำหรับรับข้อความจาก Line - SIMPLEST VERSION
app.post('/webhook', (req, res) => {
    console.log('✅ Webhook received');
    
    // ตอบ 200 ทันทีแบบง่ายที่สุด
    res.status(200).send('OK');
    
    // Log ข้อมูลที่ได้รับ
    console.log('Webhook body:', JSON.stringify(req.body, null, 2));
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
        
        // ใช้ mock data ชั่วคราว
        const reportId = Math.floor(1000 + Math.random() * 9000);
        
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
    console.log('✅ Webhook URL: /webhook');
    console.log('✅ API Report URL: /api/report');
});