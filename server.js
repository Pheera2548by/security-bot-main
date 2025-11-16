require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const { Pool } = require('pg'); // ⭐️ เพิ่ม pg

// Line Config
const config = {
    channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.CHANNEL_SECRET
};

const client = new line.Client(config);

// ⭐️ ตั้งค่าการเชื่อมต่อ Supabase (PostgreSQL)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    family: 4
});

// ⭐️ ทดสอบการเชื่อมต่อ Database
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection error:', err.stack);
  } else {
    console.log('✅ Database connected:', res.rows[0].now);
  }
});


const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public')); // ⭐️ สำหรับ liff-app.html

// Webhook สำหรับรับข้อความจาก Line
app.post('/webhook', (req, res) => {
    console.log('✅ Webhook received');
    // ตอบกลับ LINE ทันทีว่าได้รับแล้ว (สำคัญมาก)
    res.status(200).send('OK'); 
    
    try {
        const events = req.body.events || [];
        console.log(`📋 Processing ${events.length} events`);
        
        // ⭐️ ใช้ Promise.all เพื่อจัดการ event พร้อมกันและจับ error
        Promise.all(events.map(handleEvent))
            .catch(err => {
                console.error('Event processing error:', err);
            });
            
    } catch (error) {
        console.error('Webhook payload error:', error);
    }
});

// ฟังก์ชันจัดการ Event
async function handleEvent(event) {
    try {
        // ⭐️ ไม่จัดการ event ถ้าไม่ใช่ text หรือ follow
        if (event.type !== 'message' && event.type !== 'follow') {
            return null;
        }

        console.log('🔹 Handling event type:', event.type, 'Source:', event.source.userId);

        // ⭐️ เมื่อมีคนเพิ่มเพื่อน
        if (event.type === 'follow') {
            return client.replyMessage(event.replyToken, {
                type: 'text',
                text: `👋 สวัสดี! บอทรายงานความปลอดภัย\n\n💡 วิธีการใช้งาน:\n• สแกน QR Code ตามจุด\n• กดรายงานปัญหา\n• รอการแจ้งเตือนเมื่อจัดการเสร็จ\n\nสำหรับ Admin:\nพิมพ์ "รายงาน" เพื่อดูสถานะ\nพิมพ์ "help" เพื่อดูคำสั่งทั้งหมด`
            });
        }

        // ⭐️ จัดการเฉพาะข้อความที่เป็น text
        if (event.type === 'message' && event.message.type === 'text') {
            const messageText = event.message.text.trim().toLowerCase();
            const adminUserId = process.env.ADMIN_USER_ID;

            // ⭐️ ตรวจสอบว่าเป็น Admin หรือไม่ (ถ้ามีการตั้งค่าไว้)
            // ถ้าไม่ใช Admin จะตอบกลับเฉพาะ "help"
            if (adminUserId && event.source.userId !== adminUserId) {
                if (messageText === 'help' || messageText === 'ช่วยเหลือ') {
                     return client.replyMessage(event.replyToken, {
                        type: 'text',
                        text: '💡 วิธีการใช้งาน:\n\n• สแกน QR Code ตามจุด\n• กดรายงานปัญหา\n• รอการแจ้งเตือนเมื่อจัดการเสร็จ'
                    });
                }
                return null; // ไม่ใช่ Admin และไม่ใช่คำสั่ง help
            }

            // ⭐️ ถ้ามีคำว่า "เรียบร้อย" (สำหรับ Admin)
            if (messageText.includes('เรียบร้อย')) {
                let reportId;
                
                // หา reportId จากข้อความ (เช่น #1234)
                const idMatch = messageText.match(/#(\d+)/);
                if (idMatch) {
                    reportId = parseInt(idMatch[1]);
                } else {
                    // ⭐️ หารายงานล่าสุดที่ยังไม่เสร็จ จาก DB
                    const latestQuery = `
                        SELECT report_id FROM reports 
                        WHERE status = 'pending' 
                        ORDER BY created_at DESC 
                        LIMIT 1
                    `;
                    const latestResult = await pool.query(latestQuery);
                    if (latestResult.rows.length > 0) {
                        reportId = latestResult.rows[0].report_id;
                    }
                }
                
                if (reportId) {
                    // ⭐️ 1. ดึงข้อมูลรายงานจาก DB
                    const selectQuery = "SELECT * FROM reports WHERE report_id = $1 AND status = 'pending'";
                    const selectResult = await pool.query(selectQuery, [reportId]);
                    
                    if (selectResult.rows.length > 0) {
                        const report = selectResult.rows[0];
                        
                        try {
                            // ⭐️ 2. ส่งข้อความย้อนกลับให้ลูกค้า
                            await client.pushMessage(report.user_id, {
                                type: 'text',
                                text: `✅ การรายงานจุดที่ ${report.point_id} จัดการเรียบร้อยแล้ว!\n\nขอบคุณที่แจ้งปัญหาให้ทราบ 🙏`
                            });
                            console.log('✅ Sent confirmation to customer:', report.user_id);
                            
                            // ⭐️ 3. อัพเดทสถานะรายงานใน DB
                            const updateQuery = `
                                UPDATE reports 
                                SET status = 'completed', completed_at = NOW() 
                                WHERE report_id = $1
                            `;
                            await pool.query(updateQuery, [reportId]);
                            
                            // ⭐️ 4. ตอบกลับ Admin
                            return client.replyMessage(event.replyToken, {
                                type: 'text',
                                text: `✅ แจ้งย้อนกลับให้คุณ${report.display_name} เรียบร้อยแล้ว!\n📍 จุดที่ ${report.point_id}\n📝 รหัสรายงาน: #${reportId}`
                            });
                            
                        } catch (customerError) {
                            console.error('❌ Error sending to customer:', customerError);
                            return client.replyMessage(event.replyToken, {
                                type: 'text',
                                text: `❌ ไม่สามารถแจ้งลูกค้าได้ (UserID: ${report.user_id})`
                            });
                        }
                    } else {
                        return client.replyMessage(event.replyToken, {
                            type: 'text',
                            text: '❌ ไม่พบรายงานที่ต้องการยืนยัน (อาจจะยืนยันไปแล้ว หรือใส่รหัสผิด)'
                        });
                    }
                } else {
                    return client.replyMessage(event.replyToken, {
                        type: 'text',
                        text: '❌ ไม่พบรายงานที่ค้างอยู่\n\nตัวอย่าง:\n"เรียบร้อย #1234"\nหรือ "เรียบร้อย" (สำหรับรายงานล่าสุด)'
                    });
                }
            }
            
            // ⭐️ คำสั่งตรวจสอบสถานะ (สำหรับ Admin)
            if (messageText === 'รายงาน' || messageText === 'status') {
                // ⭐️ ใช้ SQL COUNT เพื่อดึงข้อมูล
                const countQuery = `
                    SELECT
                        COUNT(*) AS total,
                        COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending,
                        COUNT(CASE WHEN status = 'completed' THEN 1 END) AS completed
                    FROM reports
                `;
                const countResult = await pool.query(countQuery);
                const counts = countResult.rows[0];

                let statusText = `📊 สถานะรายงาน\n\n`;
                statusText += `📈 ทั้งหมด: ${counts.total} รายงาน\n`;
                statusText += `⏳ รอแก้ไข: ${counts.pending} รายงาน\n`;
                statusText += `✅ เสร็จสิ้น: ${counts.completed} รายงาน\n\n`;

                // ⭐️ ดึง 5 รายงานล่าสุดจาก DB
                const recentQuery = `
                    SELECT report_id, point_id, display_name, status, created_at 
                    FROM reports 
                    ORDER BY created_at DESC 
                    LIMIT 5
                `;
                const recentResult = await pool.query(recentQuery);

                if (recentResult.rows.length > 0) {
                    statusText += `📋 รายงานล่าสุด:\n`;
                    recentResult.rows.forEach(report => {
                        const statusIcon = report.status === 'pending' ? '🟡' : '✅';
                        const time = new Date(report.created_at).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' });
                        statusText += `${statusIcon} #${report.report_id} จุด ${report.point_id} (${time})\n`;
                    });
                }
                
                statusText += `\nใช้ "เรียบร้อย" เพื่อยืนยันการแก้ไข`;
                
                return client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: statusText
                });
            }
            
            // ⭐️ คำสั่ง help (สำหรับ Admin)
            if (messageText === 'help' || messageText === 'ช่วยเหลือ') {
                return client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: '💡 คำสั่งที่ใช้ได้:\n\n• "รายงาน" - ดูสถานะรายงาน\n• "เรียบร้อย" - ยืนยันการแก้ไขรายงานล่าสุด\n• "เรียบร้อย #1234" - ยืนยันรายงานเฉพาะ\n• "help" - แสดงคำสั่งนี้'
                });
            }
        }
        
    } catch (error) {
        console.error('❌ Handle event error:', error);
        // ⭐️ แจ้งเตือน Admin หากมี error
        if (process.env.ADMIN_USER_ID) {
            try {
                await client.pushMessage(process.env.ADMIN_USER_ID, {
                    type: 'text',
                    text: `🚨 Bot Error: ${error.message}`
                });
            } catch (pushError) {
                console.error('❌ Failed to send error to admin:', pushError.message);
            }
        }
    }
}

// ⭐️ API สำหรับรับรายงานจาก LIFF
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
        
        const reportId = Math.floor(1000 + Math.random() * 9000); // สุ่มรหัส 4 หลัก
        
        // ⭐️ บันทึกข้อมูลรายงานลง Database
        const queryText = `
            INSERT INTO reports (report_id, user_id, display_name, point_id, status)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, created_at
        `;
        const values = [reportId, userId, displayName, pointId, 'pending'];
        
        const dbResult = await pool.query(queryText, values);
        
        console.log('💾 Saved report to DB:', { 
            db_id: dbResult.rows[0].id, 
            reportId, 
            userId, 
            pointId 
        });
        
        // ⭐️ ส่งแจ้งเตือนไปยัง Admin
        if (process.env.ADMIN_USER_ID) {
            try {
                await client.pushMessage(process.env.ADMIN_USER_ID, {
                    type: 'text',
                    text: `🚨 รายงานใหม่!\n👤 คุณ${displayName}\n📍 จุดที่ ${pointId}\n📝 รหัส: #${reportId}\n\nพิมพ์ "เรียบร้อย #${reportId}" เพื่อยืนยัน`
                });
                console.log('✅ Sent notification to admin');
            } catch (pushError) {
                console.error('❌ Push message error:', pushError.message);
                // ไม่ต้องหยุดการทำงาน แม้ว่าจะส่งหา Admin ไม่ได้
            }
        }
        
        res.json({ 
            success: true, 
            reportId,
            message: 'รายงานสำเร็จ' 
        });
        
    } catch (error) {
        console.error('Report API error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error',
            details: error.message
        });
    }
});

// ⭐️ Health Check (หน้าหลัก)
app.get('/', async (req, res) => {
    try {
        // ⭐️ ดึงข้อมูลสถานะจาก DB
        const countQuery = `
            SELECT
                COUNT(*) AS total,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) AS completed
            FROM reports
        `;
        const countResult = await pool.query(countQuery);
        const counts = countResult.rows[0];

        res.json({ 
            status: 'OK', 
            message: 'Security Report Bot is running',
            reports: counts,
            hasChannelToken: !!process.env.CHANNEL_ACCESS_TOKEN,
            hasAdminUserId: !!process.env.ADMIN_USER_ID,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            status: 'ERROR',
            message: 'Database query failed',
            error: error.message
        });
    }
});

// ⭐️ Debug endpoint เพื่อดูข้อมูลรายงานทั้งหมด (ควรลบออกใน Production)
app.get('/debug-reports', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM reports ORDER BY created_at DESC');
        res.json({
            total: result.rowCount,
            reports: result.rows
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ⭐️ ให้ liff-app.html ทำงาน
app.get('/liff', (req, res) => {
    res.sendFile(__dirname + '/public/liff-app.html');
});


// Start Server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log('🚀 Server started on port', PORT);
    console.log('✅ Webhook is listening at /webhook');
    console.log('✅ LIFF App is served from /public');
    console.log('✅ Health Check available at /');
});