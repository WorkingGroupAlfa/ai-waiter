import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { nluRouter } from './routes/nluRoutes.js'; 
import { deviceIdMiddleware } from './middleware/deviceId.js';
import { sessionRouter } from './routes/sessionRoutes.js';
import { qrRouter } from './routes/qrRoutes.js';
import { orderRouter } from './routes/orderRoutes.js';
import { chatRouter } from './routes/chatRoutes.js'; 
import { menuRouter } from './routes/menuRoutes.js';
import { recoRouter } from './routes/recoRoutes.js';
import { deviceRouter } from './routes/deviceRoutes.js';
import { voiceRouter } from './routes/voiceRoutes.js';
import http from 'http';
import { setupVoiceWebSocket } from './ai/voiceStream.js';
import { eventsRouter } from './routes/eventsRoutes.js';
import { adminRouter } from './routes/adminRoutes.js';
import { debugRouter } from './routes/debugRoutes.js';
import { orderUiRouter } from './routes/orderUiRoutes.js';
import { actionsRouter } from './routes/actionsRoutes.js';
import path from 'path';
import { fileURLToPath } from 'url';


dotenv.config();

//
const app = express();
// app.use(
//  cors({
//   origin: 'http://localhost:3001', // откуда приходит admin-frontend
//    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
//    allowedHeaders: ['Content-Type', 'x-admin-token'],
//  })
//);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Раздаём backend/public как статику
app.use(express.static(path.join(__dirname, '../public')));


const port = process.env.PORT || 3000;

const server = http.createServer(app);

// подключаем WebSocket-стриминг голоса
setupVoiceWebSocket(server);

server.listen(port, () => {
  console.log(`AI Waiter backend listening on port ${port}`);
});

export { app };

// 🔹 Простейший CORS для разработки с поддержкой credentials
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin) {
    // Разрешаем конкретный origin из заголовка
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Vary', 'Origin');
  } else {
    // Для запросов без Origin (curl, Postman)
    res.header('Access-Control-Allow-Origin', '*');
  }

res.header(
  'Access-Control-Allow-Headers',
  'Origin, X-Requested-With, Content-Type, Accept, x-session-token, x-admin-token'
);

  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});


app.use(express.json());
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(deviceIdMiddleware);


app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/v1/session', sessionRouter);
app.use('/api/v1/qr', qrRouter);
app.use('/api/v1/orders', orderRouter);
app.use('/api/v1/order', orderUiRouter);
app.use('/api/v1/chat', chatRouter); 
app.use('/api/v1/nlu', nluRouter);
app.use('/api/v1/menu', menuRouter);
app.use('/api/v1/reco', recoRouter);
app.use('/api/v1/device', deviceRouter);
app.use('/api/v1/voice', voiceRouter);
app.use('/api/v1/events', eventsRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/debug', debugRouter);
app.use('/api/v1/actions', actionsRouter);




