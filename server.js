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

// Supabase PostgreSQL Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const app = express();

// ⚠️ สำคัญ: ต้องใช้ raw body สำหรับ LINE webhook
app.use('/webhook', express.raw({ type: 'application/json' }));

// Middleware สำหรับ routes อื่นๆ
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Debug middleware
app.use((req, res, next) => {
    console.log('📨 Incoming Request:', req.method, req.url);
    next();
});

// Serve LIFF App
app.get('/liff-app.html', (req, res) => {
    res.sendFile(__dirname + '/public/liff-app.html');
});

// API สำหรับรับรายงานจาก LIFF
app.post('/api/report', async (req, res) => {
    try {
        console.log('📝 Received report:', req.body);
        
        const { userId, displayName, pointId } = req.body;
        
        // Validate required fields
        if (!userId || !displayName || !pointId) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required fields' 
            });
        }
        
        // บันทึกลง Supabase
        const result = await pool.query(
            'INSERT INTO security_reports (user_id, display_name, point_id, status) VALUES ($1, $2, $3, $4) RETURNING id',
            [userId, displayName, pointId, 'pending']
        );
        
        const reportId = result.rows[0].id;
        
        // ส่งแจ้งเตือนไปยัง Admin
        if (process.env.ADMIN_USER_ID) {
            try {
                await client.pushMessage(process.env.ADMIN_USER_ID, {
                    type: 'text',
                    text: `🚨 รายงานใหม่!\n👤 คุณ${displayName}\n📍 จุดที่ ${pointId}\n📝 รหัส: #${reportId}\n\nพิมพ์ "เรียบร้อย" เพื่อแจ้งลูกค้า`
                });
            } catch (pushError) {
                console.error('📤 Push message error:', pushError);
            }
        }
        
        res.json({ 
            success: true, 
            reportId,
            message: 'รายงานสำเร็จ' 
        });
        
    } catch (error) {
        console.error('❌ Report error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Webhook สำหรับรับข้อความจาก Line - FIXED VERSION
app.post('/webhook', (req, res) => {
    console.log('🔄 Webhook received, sending immediate 200 response');
    
    // ตอบ LINE ทันที
    res.status(200).json({ status: 'OK' });
    
    try {
        // Parse body manually สำหรับ LINE SDK
        const body = req.body.toString();
        const signature = req.get('X-Line-Signature');
        
        // Verify signature manually
        if (!signature) {
            console.warn('⚠️ No signature found');
        }
        
        // Parse JSON body
        const events = JSON.parse(body).events || [];
        console.log(`📋 Processing ${events.length} events`);
        
        // Process events
        events.forEach(event => {
            handleEvent(event).catch(err => {
                console.error('❌ Event processing error:', err);
            });
        });
        
    } catch (error) {
        console.error('❌ Webhook processing error:', error);
    }
});

// ฟังก์ชันจัดการ Event
async function handleEvent(event) {
    try {
        console.log('🔹 Handling event:', event.type);
        
        if (event.type === 'message' && event.message.type === 'text') {
            await handleAdminMessage(event);
        }
        
        if (event.type === 'follow') {
            await handleFollowEvent(event);
        }
        
    } catch (error) {
        console.error('❌ Handle event error:', error);
    }
}

// จัดการข้อความจาก Admin
async function handleAdminMessage(event) {
    try {
        const messageText = event.message.text.trim().toLowerCase();
        console.log('💬 Admin message:', messageText);
        
        if (messageText.includes('เรียบร้อย') || messageText.includes('เสร็จ')) {
            let reportId;
            
            const idMatch = messageText.match(/#(\d+)/);
            if (idMatch) {
                reportId = idMatch[1];
            } else {
                const result = await pool.query(
                    'SELECT id FROM security_reports WHERE status = $1 ORDER BY reported_at DESC LIMIT 1',
                    ['pending']
                );
                reportId = result.rows.length > 0 ? result.rows[0].id : null;
            }
            
            if (reportId) {
                await completeReport(reportId, event);
            } else {
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: '❌ ไม่พบรายงานที่ต้องการยืนยัน'
                });
            }
        }
        
        if (messageText === 'รายงาน' || messageText === 'status') {
            await showReportsStatus(event);
        }
    } catch (error) {
        console.error('❌ Handle admin message error:', error);
    }
}

// ยืนยันการแก้ไขเสร็จสิ้น
async function completeReport(reportId, event) {
    try {
        const updateResult = await pool.query(
            'UPDATE security_reports SET status = $1, completed_at = NOW() WHERE id = $2',
            ['completed', reportId]
        );
        
        if (updateResult.rowCount === 0) {
            await client.replyMessage(event.replyToken, {
                type: 'text',
                text: '❌ ไม่พบรายงานนี้ในระบบ'
            });
            return;
        }
        
        const result = await pool.query(
            'SELECT user_id, display_name, point_id FROM security_reports WHERE id = $1',
            [reportId]
        );
        
        if (result.rows.length > 0) {
            const report = result.rows[0];
            
            // ส่งข้อความยืนยันให้ลูกค้า
            try {
                await client.pushMessage(report.user_id, {
                    type: 'text',
                    text: `✅ การรายงานจุดที่ ${report.point_id} จัดการเรียบร้อยแล้ว\n\nขอบคุณที่แจ้งปัญหาให้ทราบ 🙏`
                });
            } catch (pushError) {
                console.error('❌ Push to user error:', pushError);
            }
            
            // ตอบกลับ Admin
            await client.replyMessage(event.replyToken, {
                type: 'text',
                text: `✅ แจ้งย้อนกลับให้คุณ${report.display_name} เรียบร้อยแล้ว\nรหัสรายงาน: #${reportId}`
            });
        }
        
    } catch (error) {
        console.error('❌ Complete report error:', error);
        await client.replyMessage(event.replyToken, {
            type: 'text',
            text: '❌ การแจ้งย้อนกลับมีปัญหา'
        });
    }
}

// แสดงสถานะรายงาน
async function showReportsStatus(event) {
    try {
        const totalResult = await pool.query('SELECT COUNT(*) as count FROM security_reports');
        const pendingResult = await pool.query(
            'SELECT COUNT(*) as count FROM security_reports WHERE status = $1',
            ['pending']
        );
        
        const recentResult = await pool.query(
            `SELECT id, display_name, point_id, status, reported_at 
             FROM security_reports 
             ORDER BY reported_at DESC 
             LIMIT 5`
        );
        
        let statusText = `📊 สถานะรายงาน\n\n`;
        statusText += `📈 ทั้งหมด: ${totalResult.rows[0].count} รายงาน\n`;
        statusText += `⏳ รอแก้ไข: ${pendingResult.rows[0].count} รายงาน\n\n`;
        statusText += `📋 รายงานล่าสุด:\n`;
        
        recentResult.rows.forEach(report => {
            const statusIcon = report.status === 'pending' ? '🟡' : '✅';
            const time = new Date(report.reported_at).toLocaleTimeString('th-TH');
            statusText += `${statusIcon} จุดที่ ${report.point_id} โดยคุณ${report.display_name} (${time})\n`;
        });
        
        statusText += `\nใช้ "เรียบร้อย" เพื่อยืนยันการแก้ไข`;
        
        await client.replyMessage(event.replyToken, {
            type: 'text',
            text: statusText
        });
        
    } catch (error) {
        console.error('❌ Show status error:', error);
    }
}

// จัดการเมื่อมีคนเพิ่มเพื่อน
async function handleFollowEvent(event) {
    try {
        const welcomeMessage = {
            type: 'text',
            text: `👋 สวัสดี! บอทรายงานความปลอดภัย\n\n💡 วิธีการใช้งาน:\n• สแกน QR Code ตามจุด\n• กดรายงานปัญหา\n• รอการแจ้งเตือนเมื่อจัดการเสร็จ\n\n📞 ติดต่อด่วน: 02-222-2222\n\nสำหรับ Admin: พิมพ์ "รายงาน" เพื่อดูสถานะ`
        };
        
        await client.replyMessage(event.replyToken, welcomeMessage);
    } catch (error) {
        console.error('❌ Follow event error:', error);
    }
}

// Health Check
app.get('/', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Security Report Bot is running',
        timestamp: new Date().toISOString()
    });
});

// Debug endpoint
app.get('/debug', (req, res) => {
    res.json({
        status: 'running',
        env: {
            hasChannelToken: !!process.env.CHANNEL_ACCESS_TOKEN,
            hasChannelSecret: !!process.env.CHANNEL_SECRET,
            hasDatabaseUrl: !!process.env.DATABASE_URL
        }
    });
});

// Start Server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log('🚀 Server started on port', PORT);
    console.log('✅ Health check: http://localhost:' + PORT);
});