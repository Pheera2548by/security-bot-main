require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');

// Line Config
const config = {
    channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.CHANNEL_SECRET
};

const client = new line.Client(config);

// Memory storage ชั่วคราว (แทน database)
const reportsStorage = new Map();

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
                let reportId;
                
                // หา reportId จากข้อความ
                const idMatch = messageText.match(/#(\d+)/);
                if (idMatch) {
                    reportId = parseInt(idMatch[1]);
                } else {
                    // หารายงานล่าสุดที่ยังไม่เสร็จ
                    const pendingReports = Array.from(reportsStorage.entries())
                        .filter(([id, report]) => report.status === 'pending')
                        .sort((a, b) => b[1].createdAt - a[1].createdAt);
                    
                    if (pendingReports.length > 0) {
                        reportId = pendingReports[0][0];
                    }
                }
                
                if (reportId && reportsStorage.has(reportId)) {
                    const report = reportsStorage.get(reportId);
                    
                    // ส่งข้อความย้อนกลับให้ลูกค้า
                    try {
                        await client.pushMessage(report.userId, {
                            type: 'text',
                            text: `✅ การรายงานจุดที่ ${report.pointId} จัดการเรียบร้อยแล้ว!\n\nขอบคุณที่แจ้งปัญหาให้ทราบ 🙏`
                        });
                        console.log('✅ Sent confirmation to customer:', report.userId);
                        
                        // อัพเดทสถานะรายงาน
                        report.status = 'completed';
                        report.completedAt = new Date();
                        reportsStorage.set(reportId, report);
                        
                        // ตอบกลับ Admin
                        await client.replyMessage(event.replyToken, {
                            type: 'text',
                            text: `✅ แจ้งย้อนกลับให้คุณ${report.displayName} เรียบร้อยแล้ว!\n📍 จุดที่ ${report.pointId}\n📝 รหัสรายงาน: #${reportId}`
                        });
                        
                    } catch (customerError) {
                        console.error('❌ Error sending to customer:', customerError);
                        await client.replyMessage(event.replyToken, {
                            type: 'text',
                            text: '❌ ไม่สามารถแจ้งลูกค้าได้'
                        });
                    }
                    
                } else {
                    await client.replyMessage(event.replyToken, {
                        type: 'text',
                        text: '❌ ไม่พบรายงานที่ต้องการยืนยัน\n\nตัวอย่าง:\n"เรียบร้อย #123"\nหรือ "เรียบร้อย" (สำหรับรายงานล่าสุด)'
                    });
                }
            }
            
            // คำสั่งตรวจสอบสถานะ
            if (messageText === 'รายงาน' || messageText === 'status') {
                const pendingReports = Array.from(reportsStorage.values())
                    .filter(report => report.status === 'pending');
                const completedReports = Array.from(reportsStorage.values())
                    .filter(report => report.status === 'completed');
                
                let statusText = `📊 สถานะรายงาน\n\n`;
                statusText += `📈 ทั้งหมด: ${reportsStorage.size} รายงาน\n`;
                statusText += `⏳ รอแก้ไข: ${pendingReports.length} รายงาน\n`;
                statusText += `✅ เสร็จสิ้น: ${completedReports.length} รายงาน\n\n`;
                
                // แสดงรายงานล่าสุด 3 รายการ
                const recentReports = Array.from(reportsStorage.entries())
                    .sort((a, b) => b[1].createdAt - a[1].createdAt)
                    .slice(0, 3);
                
                if (recentReports.length > 0) {
                    statusText += `📋 รายงานล่าสุด:\n`;
                    recentReports.forEach(([id, report]) => {
                        const statusIcon = report.status === 'pending' ? '🟡' : '✅';
                        const time = report.createdAt.toLocaleTimeString('th-TH');
                        statusText += `${statusIcon} #${id} จุดที่ ${report.pointId} โดยคุณ${report.displayName} (${time})\n`;
                    });
                }
                
                statusText += `\nใช้ "เรียบร้อย" เพื่อยืนยันการแก้ไข`;
                
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: statusText
                });
            }
            
            // คำสั่ง help
            if (messageText === 'help' || messageText === 'ช่วยเหลือ') {
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: '💡 คำสั่งที่ใช้ได้:\n\n• "รายงาน" - ดูสถานะรายงาน\n• "เรียบร้อย" - ยืนยันการแก้ไขรายงานล่าสุด\n• "เรียบร้อย #123" - ยืนยันรายงานเฉพาะ\n• "help" - แสดงคำสั่งนี้'
                });
            }
        }
        
        // เมื่อมีคนเพิ่มเพื่อน
        if (event.type === 'follow') {
            await client.replyMessage(event.replyToken, {
                type: 'text',
                text: `👋 สวัสดี! บอทรายงานความปลอดภัย\n\n💡 วิธีการใช้งาน:\n• สแกน QR Code ตามจุด\n• กดรายงานปัญหา\n• รอการแจ้งเตือนเมื่อจัดการเสร็จ\n\nสำหรับ Admin:\nพิมพ์ "รายงาน" เพื่อดูสถานะ\nพิมพ์ "help" เพื่อดูคำสั่งทั้งหมด`
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
        
        // บันทึกข้อมูลรายงานไว้ใน memory
        reportsStorage.set(reportId, {
            userId: userId,
            displayName: displayName,
            pointId: pointId,
            status: 'pending',
            createdAt: new Date()
        });
        
        console.log('💾 Saved report to memory:', { reportId, userId, displayName, pointId });
        
        // ส่งแจ้งเตือนไปยัง Admin
        if (process.env.ADMIN_USER_ID) {
            try {
                await client.pushMessage(process.env.ADMIN_USER_ID, {
                    type: 'text',
                    text: `🚨 รายงานใหม่!\n👤 คุณ${displayName}\n📍 จุดที่ ${pointId}\n📝 รหัส: #${reportId}\n\nพิมพ์ "เรียบร้อย" เพื่อแจ้งลูกค้า`
                });
                console.log('✅ Sent notification to admin');
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
    const reportCounts = {
        total: reportsStorage.size,
        pending: Array.from(reportsStorage.values()).filter(r => r.status === 'pending').length,
        completed: Array.from(reportsStorage.values()).filter(r => r.status === 'completed').length
    };
    
    res.json({ 
        status: 'OK', 
        message: 'Security Report Bot is running',
        reports: reportCounts,
        hasChannelToken: !!process.env.CHANNEL_ACCESS_TOKEN,
        hasAdminUserId: !!process.env.ADMIN_USER_ID,
        timestamp: new Date().toISOString()
    });
});

// Debug endpoint เพื่อดูข้อมูลรายงานทั้งหมด
app.get('/debug-reports', (req, res) => {
    const reports = Array.from(reportsStorage.entries()).map(([id, report]) => ({
        id,
        ...report,
        createdAt: report.createdAt.toISOString(),
        completedAt: report.completedAt ? report.completedAt.toISOString() : null
    }));
    
    res.json({
        total: reportsStorage.size,
        reports: reports
    });
});

// Start Server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log('🚀 Server started on port', PORT);
    console.log('✅ Webhook URL: https://security-bot-main-production.up.railway.app/webhook');
    console.log('✅ LIFF App: https://security-bot-main-production.up.railway.app/liff-app.html');
    console.log('✅ Health Check: https://security-bot-main-production.up.railway.app/');
    console.log('📊 Current reports in memory:', reportsStorage.size);
});