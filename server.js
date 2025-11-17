require('dotenv').config();
console.log('⚡️ SERVER STARTING (With Retry Logic)...');

const express = require('express');
const line = require('@line/bot-sdk');
const { Pool } = require('pg');

// Line Config
const config = {
    channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.CHANNEL_SECRET
};

const client = new line.Client(config);

// ⭐️ ตั้งค่าการเชื่อมต่อ Supabase (PostgreSQL)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
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
app.use(express.static('public'));

// ---------------------------------------------------------
// 🛠️ Helper Functions: ฟังก์ชันช่วยส่งข้อความแบบพิเศษ
// ---------------------------------------------------------

// ฟังก์ชันหน่วงเวลา (Sleep)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ฟังก์ชันส่งข้อความแบบ "ตื๊อ" (Retry) และเช็คสถานะเพื่อน
async function sendPushMessageWithRetry(userId, messages, maxRetries = 1) {
    for (let i = 0; i <= maxRetries; i++) {
        try {
            // 1. ลองเช็คสถานะเพื่อนก่อน (ถ้าดึง Profile ไม่ได้ = บล็อก หรือ ยังไม่เพิ่มเพื่อน)
            try {
                await client.getProfile(userId);
            } catch (profileError) {
                console.warn(`⚠️ Attempt ${i+1}: Cannot get profile for ${userId}. User might not be a friend.`);
                // ไม่ throw error ตรงนี้ เผื่อฟลุ๊คส่งได้ ให้ไปลองส่งเลย
            }

            // 2. พยายามส่งข้อความ
            await client.pushMessage(userId, messages);
            console.log(`✅ Sent message to ${userId} success!`);
            return true; // ส่งสำเร็จ ออกจากฟังก์ชันทันที

        } catch (error) {
            console.error(`❌ Send attempt ${i + 1} failed: ${error.message}`);
            
            // ถ้ายังไม่ครบจำนวนครั้ง ให้รอและลองใหม่
            if (i < maxRetries) {
                console.log('⏳ Waiting 2 seconds before retry...');
                await delay(2000); // รอ 2 วินาที
            } else {
                // ถ้าครบกำหนดแล้วยังไม่ได้ ให้โยน Error ออกไป
                console.error('❌ All retry attempts failed.');
                throw error; 
            }
        }
    }
}

// ---------------------------------------------------------
// 🔗 Webhook & Event Handling
// ---------------------------------------------------------

app.post('/webhook', (req, res) => {
    console.log('✅ Webhook received');
    res.status(200).send('OK'); 
    
    try {
        const events = req.body.events || [];
        Promise.all(events.map(handleEvent))
            .catch(err => console.error('Event processing error:', err));     
    } catch (error) {
        console.error('Webhook payload error:', error);
    }
});

async function handleEvent(event) {
    try {
        if (event.type !== 'message' && event.type !== 'follow') return null;

        // ⭐️ เมื่อมีคนเพิ่มเพื่อน (Greeting)
        if (event.type === 'follow') {
            return client.replyMessage(event.replyToken, {
                type: 'text',
                text: `👋 สวัสดีครับ! บอทรายงานความปลอดภัย\n\nเมื่อท่านสแกน QR Code เพื่อรายงาน\nระบบจะส่งแจ้งเตือนความคืบหน้าผ่านทางนี้ครับ`
            });
        }

        if (event.type === 'message' && event.message.type === 'text') {
            const messageText = event.message.text.trim();
            const adminUserId = process.env.ADMIN_USER_ID;

            // ตรวจสอบ Admin (ถ้ามี)
            if (adminUserId && event.source.userId !== adminUserId) {
                if (messageText.toLowerCase() === 'help') {
                     return client.replyMessage(event.replyToken, { type: 'text', text: 'สำหรับเจ้าหน้าที่เท่านั้นครับ' });
                }
                return null;
            }

            // ⭐️ คำสั่ง: "เรียบร้อย #..." (ปิดงาน)
            if (messageText.includes('เรียบร้อย')) {
                let reportId;
                const idMatch = messageText.match(/#(\d+)/);
                
                if (idMatch) {
                    reportId = parseInt(idMatch[1]);
                } else {
                    // หาอันล่าสุดที่ยัง Pending
                    const latestQuery = `SELECT report_id FROM reports WHERE status = 'pending' ORDER BY created_at DESC LIMIT 1`;
                    const latestResult = await pool.query(latestQuery);
                    if (latestResult.rows.length > 0) reportId = latestResult.rows[0].report_id;
                }
                
                if (reportId) {
                    const selectQuery = "SELECT * FROM reports WHERE report_id = $1 AND status = 'pending'";
                    const selectResult = await pool.query(selectQuery, [reportId]);
                    
                    if (selectResult.rows.length > 0) {
                        const report = selectResult.rows[0];
                        
                        // อัพเดท DB ก่อน
                        const updateQuery = `UPDATE reports SET status = 'completed', completed_at = NOW() WHERE report_id = $1`;
                        await pool.query(updateQuery, [reportId]);

                        // ตอบกลับ Admin
                        await client.replyMessage(event.replyToken, {
                            type: 'text',
                            text: `✅ แจ้งย้อนกลับให้คุณ${report.display_name} เรียบร้อยแล้ว!\n📍 จุดที่ ${report.point_id}\n📝 รหัสรายงาน: #${reportId}`
                        });

                        // ⭐️ ส่งข้อความหาลูกค้า (ใช้ระบบ Retry ใหม่!)
                        try {
                            await sendPushMessageWithRetry(report.user_id, {
                                type: 'text',
                                text: `✅ การรายงานจุดที่ ${report.point_id} จัดการเรียบร้อยแล้ว!\n\nขอบคุณที่แจ้งปัญหาให้ทราบ 🙏`
                            });
                        } catch (customerError) {
                            // ถ้าส่งหาลูกค้าไม่ได้ ให้แจ้งเตือน Admin เพิ่ม
                            console.error('❌ Failed to notify customer:', customerError.message);
                            if (adminUserId) {
                                await client.pushMessage(adminUserId, {
                                    type: 'text',
                                    text: `⚠️ แจ้งเตือน: ส่งข้อความหาลูกค้าไม่ได้ (งาน #${reportId})\nสาเหตุ: ลูกค้าอาจบล็อกบอท หรือยังไม่เพิ่มเพื่อน`
                                });
                            }
                        }

                    } else {
                        return client.replyMessage(event.replyToken, { type: 'text', text: '❌ ไม่พบรายงานที่ต้องการยืนยัน หรือปิดงานไปแล้ว' });
                    }
                } else {
                    return client.replyMessage(event.replyToken, { type: 'text', text: '❌ ไม่พบรายงานที่ค้างอยู่' });
                }
            }
            
            // ⭐️ คำสั่ง: รายงาน/status
            if (messageText === 'รายงาน' || messageText === 'status') {
                const countQuery = `SELECT COUNT(*) AS total, COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending FROM reports`;
                const countResult = await pool.query(countQuery);
                const counts = countResult.rows[0];
                
                // ดึง 5 รายงานล่าสุด
                const recentQuery = `SELECT report_id, point_id, display_name, status, created_at FROM reports ORDER BY created_at DESC LIMIT 5`;
                const recentResult = await pool.query(recentQuery);

                let statusText = `📊 สถานะรายงาน\n⏳ รอแก้ไข: ${counts.pending}\n📈 ทั้งหมด: ${counts.total}\n\n📋 ล่าสุด:\n`;
                
                if (recentResult.rows.length > 0) {
                    recentResult.rows.forEach(report => {
                        const icon = report.status === 'pending' ? '🟡' : '✅';
                        const time = new Date(report.created_at).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute:'2-digit' });
                        statusText += `${icon} #${report.report_id} ${report.point_id} (${time})\n`;
                    });
                }
                
                return client.replyMessage(event.replyToken, { type: 'text', text: statusText });
            }

            // ⭐️ คำสั่ง: Help
            if (messageText === 'help' || messageText === 'ช่วยเหลือ') {
                return client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: '💡 คำสั่ง:\n• "รายงาน" - ดูสถานะ\n• "เรียบร้อย" - ปิดงานล่าสุด\n• "เรียบร้อย #1234" - ปิดงานตามรหัส'
                });
            }
        }
    } catch (error) {
        console.error('❌ Handle event error:', error);
    }
}

// ---------------------------------------------------------
// 📡 API: รับรายงานจาก LIFF
// ---------------------------------------------------------

app.post('/api/report', async (req, res) => {
    console.log('📝 API Report received:', req.body);
    
    try {
        const { userId, displayName, pointId } = req.body;
        
        if (!userId || !displayName || !pointId) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        
        const reportId = Math.floor(1000 + Math.random() * 9000);
        
        // 1. บันทึกข้อมูล (สำคัญที่สุด ต้องทำให้เสร็จก่อน)
        const queryText = `
            INSERT INTO reports (report_id, user_id, display_name, point_id, status)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
        `;
        const values = [reportId, userId, displayName, pointId, 'pending'];
        await pool.query(queryText, values);
        
        console.log(`💾 Saved report #${reportId} to DB`);
        
        // 2. แจ้งเตือน Admin (Fire and Forget - ไม่ต้องรอให้เสร็จก็ได้)
        if (process.env.ADMIN_USER_ID) {
            client.pushMessage(process.env.ADMIN_USER_ID, {
                type: 'text',
                text: `🚨 รายงานใหม่!\n👤 คุณ${displayName}\n📍 จุดที่ ${pointId}\n📝 รหัส: #${reportId}\n\nพิมพ์ "เรียบร้อย #${reportId}" เพื่อยืนยัน`
            }).catch(err => console.error('❌ Admin push failed:', err.message));
        }

        // 3. (Optional) แจ้งลูกค้าว่า "รับเรื่องแล้ว" (ใช้ Retry Logic)
        // ทำแบบ Async ไม่ต้องรอให้เสร็จถึงจะตอบกลับ LIFF เพื่อความเร็ว
        sendPushMessageWithRetry(userId, {
            type: 'text',
            text: `✅ รับเรื่องจุด ${pointId} แล้วครับ\nเจ้าหน้าที่จะรีบดำเนินการตรวจสอบ 🕒`
        }).catch(err => console.log('User notification skipped/failed (Normal if not friend)'));

        // ตอบกลับ LIFF ทันที
        res.json({ 
            success: true, 
            reportId,
            message: 'รายงานสำเร็จ' 
        });
        
    } catch (error) {
        console.error('Report API error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Routes ทั่วไป
app.get('/', (req, res) => res.send('Security Bot is Running 🚀'));
app.get('/liff', (req, res) => res.sendFile(__dirname + '/public/liff-app.html'));

// Start Server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log('🚀 Server started on port', PORT);
});