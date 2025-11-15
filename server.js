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

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Serve LIFF App
app.get('/liff-app.html', (req, res) => {
    res.sendFile(__dirname + '/public/liff-app.html');
});

// API สำหรับรับรายงานจาก LIFF
app.post('/api/report', async (req, res) => {
    try {
        console.log('Received report:', req.body);
        
        const { userId, displayName, pointId } = req.body;
        
        // บันทึกลง Supabase
        const result = await pool.query(
            'INSERT INTO security_reports (user_id, display_name, point_id) VALUES ($1, $2, $3) RETURNING id',
            [userId, displayName, pointId]
        );
        
        const reportId = result.rows[0].id;
        
        // ส่งแจ้งเตือนไปยัง Admin
        await client.pushMessage(process.env.ADMIN_USER_ID, {
            type: 'text',
            text: `🚨 รายงานใหม่!\n👤 คุณ${displayName}\n📍 จุดที่ ${pointId}\n📝 รหัส: #${reportId}\n\nพิมพ์ "เรียบร้อย" เพื่อแจ้งลูกค้า`
        });
        
        res.json({ 
            success: true, 
            reportId,
            message: 'รายงานสำเร็จ' 
        });
        
    } catch (error) {
        console.error('Report error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Webhook สำหรับรับข้อความจาก Line
app.post('/webhook', line.middleware(config), async (req, res) => {
    try {
        console.log('Webhook received:', req.body.events);
        
        const events = req.body.events;
        for (const event of events) {
            await handleEvent(event);
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ success: false });
    }
});

// ฟังก์ชันจัดการ Event
async function handleEvent(event) {
    try {
        // รับข้อความจาก Admin
        if (event.type === 'message' && event.message.type === 'text') {
            await handleAdminMessage(event);
        }
        
        // มีคนเพิ่มบอทเป็นเพื่อน
        if (event.type === 'follow') {
            await handleFollowEvent(event);
        }
        
    } catch (error) {
        console.error('Handle event error:', error);
    }
}

// จัดการข้อความจาก Admin
async function handleAdminMessage(event) {
    const messageText = event.message.text.trim().toLowerCase();
    
    // ถ้ามีคำว่า "เรียบร้อย" หรือ "เสร็จ"
    if (messageText.includes('เรียบร้อย') || messageText.includes('เสร็จ')) {
        let reportId;
        
        // หา reportId จากข้อความ
        const idMatch = messageText.match(/#(\d+)/);
        if (idMatch) {
            reportId = idMatch[1];
        } else {
            // หารายงานล่าสุดที่ยังไม่เสร็จ
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
                text: '❌ ไม่พบรายงานที่ต้องการยืนยัน\n\nตัวอย่าง:\n"เรียบร้อย #123"\nหรือ "เรียบร้อย" (สำหรับรายงานล่าสุด)'
            });
        }
    }
    
    // คำสั่งตรวจสอบรายงาน
    if (messageText === 'รายงาน' || messageText === 'status') {
        await showReportsStatus(event);
    }
}

// ยืนยันการแก้ไขเสร็จสิ้น
async function completeReport(reportId, event) {
    try {
        // อัพเดทสถานะใน Supabase
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
        
        // ดึงข้อมูลรายงาน
        const result = await pool.query(
            'SELECT user_id, display_name, point_id FROM security_reports WHERE id = $1',
            [reportId]
        );
        
        if (result.rows.length > 0) {
            const report = result.rows[0];
            
            // ส่งข้อความยืนยันให้ลูกค้า
            await client.pushMessage(report.user_id, {
                type: 'text',
                text: `✅ การรายงานจุดที่ ${report.point_id} จัดการเรียบร้อยแล้ว\n\nขอบคุณที่แจ้งปัญหาให้ทราบ 🙏`
            });
            
            // ตอบกลับ Admin
            await client.replyMessage(event.replyToken, {
                type: 'text',
                text: `✅ แจ้งย้อนกลับให้คุณ${report.display_name} จุดที่ ${report.point_id} เรียบร้อยแล้ว\nรหัสรายงาน: #${reportId}`
            });
        }
        
    } catch (error) {
        console.error('Complete report error:', error);
        await client.replyMessage(event.replyToken, {
            type: 'text',
            text: '❌ การแจ้งย้อนกลับมีปัญหา'
        });
    }
}

// แสดงสถานะรายงาน
async function showReportsStatus(event) {
    try {
        // นับรายงานทั้งหมด
        const totalResult = await pool.query('SELECT COUNT(*) as count FROM security_reports');
        
        // นับรายงานที่รอแก้ไข
        const pendingResult = await pool.query(
            'SELECT COUNT(*) as count FROM security_reports WHERE status = $1',
            ['pending']
        );
        
        // รายงานล่าสุด 5 รายการ
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
        console.error('Show status error:', error);
    }
}

// จัดการเมื่อมีคนเพิ่มเพื่อน
async function handleFollowEvent(event) {
    const welcomeMessage = {
        type: 'text',
        text: `👋 สวัสดี! บอทรายงานความปลอดภัย\n\n💡 วิธีการใช้งาน:\n• สแกน QR Code ตามจุด\n• กดรายงานปัญหา\n• รอการแจ้งเตือนเมื่อจัดการเสร็จ\n\n📞 ติดต่อด่วน: 02-222-2222\n\nสำหรับ Admin: พิมพ์ "รายงาน" เพื่อดูสถานะ`
    };
    
    await client.replyMessage(event.replyToken, welcomeMessage);
}

// Health Check
app.get('/', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Security Report Bot is running',
        database: 'Supabase PostgreSQL',
        timestamp: new Date().toISOString()
    });
});

// Start Server
const PORT = "8888"
app.listen(PORT, () => {
    console.log('🚀 Server started on port', PORT);
    console.log('🗃️ Database: Supabase PostgreSQL');
});