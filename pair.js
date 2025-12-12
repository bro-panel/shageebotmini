const express = require('express');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const ytdl = require('ytdl-core');
const yts = require('yt-search');
const FileType = require('file-type');
const AdmZip = require('adm-zip');
const mongoose = require('mongoose');
const { sendTranslations } = require("./data/sendTranslations");

if (fs.existsSync('2nd_dev_config.env')) require('dotenv').config({ path: './2nd_dev_config.env' });

const { sms } = require("./msg");

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    proto,
    prepareWAMessageMedia,
    downloadContentFromMessage,
    getContentType,
    generateWAMessageFromContent
} = require('@whiskeysockets/baileys');

// MongoDB Configuration
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://dinu60970_db_user:RfGn7kG6A5jLe2px@cluster0.4yb6fvp.mongodb.net/';

process.env.NODE_ENV = 'production';
process.env.PM2_NAME = 'smd-session';

console.log('🚀 Auto Session Manager initialized with MongoDB Atlas');

// Configs
const footer = `> 𝗦ꁝꋬG̷E̷E ᗰＤᎷƖ𝑵Ɩ 𝗕૦𝚃 𝗕Ⲩ Ｄ𝞔𝓦 𝘚Η𝔸ɢ𝞔𝞔 l ꙰╰_╯`
const logo = `https://files.catbox.moe/069me0.png`;
const caption = `𝘚Η𝔸ɢ𝞔𝞔.ᎷƖ𝑵Ɩ 𝗕૦𝚃`; 
const botName = '𝑆𝐻𝜟Ꮹ𝛯𝛯 𝛭𝐷'
const mainSite = 'dew-md.free.nf';
const apibase = 'https://dew-api.vercel.app'
const apikey = `free`;

const config = {
    // General Bot Settings
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'true',
    AUTO_LIKE_EMOJI: ['💗', '🔥'],
    BUTTON: 'true',

    // Newsletter Auto-React Settings
    AUTO_REACT_NEWSLETTERS: 'true',

    NEWSLETTER_JIDS: ['120363421350428668@newsletter'],
    NEWSLETTER_REACT_EMOJIS: ['❤️', '😗', '🩷'],

    // OPTIMIZED Auto Session Management
    AUTO_SAVE_INTERVAL: 360000,        // Auto-save every 5 minutes
    AUTO_CLEANUP_INTERVAL: 1800000,    // Cleanup every 30 minutes
    AUTO_RECONNECT_INTERVAL: 300000,   // Check reconnection every 5 minutes
    AUTO_RESTORE_INTERVAL: 360000,    // Auto-restore every 1 hour
    MONGODB_SYNC_INTERVAL: 600000,     // Sync with MongoDB every 10 minutes
    MAX_SESSION_AGE: 2592000000,       // 30 days in milliseconds
    DISCONNECTED_CLEANUP_TIME: 180000, // 5 minutes for disconnected sessions
    MAX_FAILED_ATTEMPTS: 2,            // Max failed reconnection attempts
    INITIAL_RESTORE_DELAY: 10000,      // Wait 10 seconds before initial restore
    IMMEDIATE_DELETE_DELAY: 600000,    // Wait 5 minutes before deleting invalid sessions

    // Command Settings
    PREFIX: '.',
    MAX_RETRIES: 3,

    // Group & Channel Settings
    NEWSLETTER_JID: '120363421350428668@newsletter',

    // File Paths
    ADMIN_LIST_PATH: './data/admin.json',
    NUMBER_LIST_PATH: './numbers.json',
    SESSION_STATUS_PATH: './session_status.json',
    SESSION_BASE_PATH: './session',

    // Owner Details
    OWNER_NUMBER: '94704602578',
};

// Session Management Maps
const activeSockets = new Map();
const socketCreationTime = new Map();
const disconnectionTime = new Map();
const sessionHealth = new Map();
const reconnectionAttempts = new Map();
const lastBackupTime = new Map();
const otpStore = new Map();
const pendingSaves = new Map();
const restoringNumbers = new Set();
const sessionConnectionStatus = new Map();

// Auto-management intervals
let autoSaveInterval;
let autoCleanupInterval;
let autoReconnectInterval;
let autoRestoreInterval;
let mongoSyncInterval;

// MongoDB Connection
let mongoConnected = false;

// MongoDB Schemas
const sessionSchema = new mongoose.Schema({
    number: { type: String, required: true, unique: true, index: true },
    sessionData: { type: Object, required: true },
    status: { type: String, default: 'active', index: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now },
    health: { type: String, default: 'active' }
});

const userConfigSchema = new mongoose.Schema({
    number: { type: String, required: true, unique: true, index: true },
    config: { type: Object, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const Session = mongoose.model('Session', sessionSchema);
const UserConfig = mongoose.model('UserConfig', userConfigSchema);

// Initialize MongoDB Connection
async function initializeMongoDB() {
    try {
        if (mongoConnected) return true;

        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 30000,
            socketTimeoutMS: 45000,
        });

        mongoConnected = true;
        console.log('✅ MongoDB Atlas connected successfully');

        // Create indexes
        await Session.createIndexes();
        await UserConfig.createIndexes();

        return true;
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        mongoConnected = false;
        
        // Retry connection after 5 seconds
        setTimeout(() => {
            initializeMongoDB();
        }, 5000);
        
        return false;
    }
}

// MongoDB Session Management Functions
async function saveSessionToMongoDB(number, sessionData) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');

        if (!isSessionActive(sanitizedNumber)) {
            console.log(`⏭️ Not saving inactive session to MongoDB: ${sanitizedNumber}`);
            return false;
        }

        await Session.findOneAndUpdate(
            { number: sanitizedNumber },
            {
                sessionData: sessionData,
                status: 'active',
                updatedAt: new Date(),
                lastActive: new Date(),
                health: sessionHealth.get(sanitizedNumber) || 'active'
            },
            { upsert: true, new: true }
        );

        console.log(`✅ Session saved to MongoDB: ${sanitizedNumber}`);
        return true;
    } catch (error) {
        console.error(`❌ MongoDB save failed for ${number}:`, error.message);
        pendingSaves.set(number, {
            data: sessionData,
            timestamp: Date.now()
        });
        return false;
    }
}

async function loadSessionFromMongoDB(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        
        const session = await Session.findOne({ 
            number: sanitizedNumber,
            status: { $ne: 'deleted' }
        });

        if (session) {
            console.log(`✅ Session loaded from MongoDB: ${sanitizedNumber}`);
            return session.sessionData;
        }

        return null;
    } catch (error) {
        console.error(`❌ MongoDB load failed for ${number}:`, error.message);
        return null;
    }
}

async function deleteSessionFromMongoDB(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');

        // Delete session
        await Session.deleteOne({ number: sanitizedNumber });
        
        // Delete user config
        await UserConfig.deleteOne({ number: sanitizedNumber });

        console.log(`🗑️ Session deleted from MongoDB: ${sanitizedNumber}`);
        return true;
    } catch (error) {
        console.error(`❌ MongoDB delete failed for ${number}:`, error.message);
        return false;
    }
}

async function getAllActiveSessionsFromMongoDB() {
    try {
        const sessions = await Session.find({ 
            status: 'active',
            health: { $ne: 'invalid' }
        });

        console.log(`📊 Found ${sessions.length} active sessions in MongoDB`);
        return sessions;
    } catch (error) {
        console.error('❌ Failed to get sessions from MongoDB:', error.message);
        return [];
    }
}

async function updateSessionStatusInMongoDB(number, status, health = null) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');

        const updateData = {
            status: status,
            updatedAt: new Date()
        };

        if (health) {
            updateData.health = health;
        }

        if (status === 'active') {
            updateData.lastActive = new Date();
        }

        await Session.findOneAndUpdate(
            { number: sanitizedNumber },
            updateData,
            { upsert: false }
        );

        console.log(`📝 Session status updated in MongoDB: ${sanitizedNumber} -> ${status}`);
        return true;
    } catch (error) {
        console.error(`❌ MongoDB status update failed for ${number}:`, error.message);
        return false;
    }
}

async function cleanupInactiveSessionsFromMongoDB() {
    try {
        // Delete sessions that are disconnected or invalid
        const result = await Session.deleteMany({
            $or: [
                { status: 'disconnected' },
                { status: 'invalid' },
                { status: 'failed' },
                { health: 'invalid' },
                { health: 'disconnected' }
            ]
        });

        console.log(`🧹 Cleaned ${result.deletedCount} inactive sessions from MongoDB`);
        return result.deletedCount;
    } catch (error) {
        console.error('❌ MongoDB cleanup failed:', error.message);
        return 0;
    }
}

async function getMongoSessionCount() {
    try {
        const count = await Session.countDocuments({ status: 'active' });
        return count;
    } catch (error) {
        console.error('❌ Failed to count MongoDB sessions:', error.message);
        return 0;
    }
}

// User Config MongoDB Functions
async function saveUserConfigToMongoDB(number, configData) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');

        await UserConfig.findOneAndUpdate(
            { number: sanitizedNumber },
            {
                config: configData,
                updatedAt: new Date()
            },
            { upsert: true, new: true }
        );

        console.log(`✅ User config saved to MongoDB: ${sanitizedNumber}`);
        return true;
    } catch (error) {
        console.error(`❌ MongoDB config save failed for ${number}:`, error.message);
        return false;
    }
}

async function loadUserConfigFromMongoDB(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        
        const userConfig = await UserConfig.findOne({ number: sanitizedNumber });

        if (userConfig) {
            console.log(`✅ User config loaded from MongoDB: ${sanitizedNumber}`);
            return userConfig.config;
        }

        return null;
    } catch (error) {
        console.error(`❌ MongoDB config load failed for ${number}:`, error.message);
        return null;
    }
}

// Create necessary directories
function initializeDirectories() {
    const dirs = [
        config.SESSION_BASE_PATH,
        './temp'
    ];

    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`📁 Created directory: ${dir}`);
        }
    });
}

initializeDirectories();

if (!fs.existsSync('./setting')) {
  fs.mkdirSync('./setting');
}


// **HELPER FUNCTIONS**

async function downloadAndSaveMedia(message, mediaType) {
    try {
        const stream = await downloadContentFromMessage(message, mediaType);
        let buffer = Buffer.from([]);

        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        return buffer;
    } catch (error) {
        console.error('Download Media Error:', error);
        throw error;
    }
}

// Check if command is from owner
function isOwner(sender) {
    const senderNumber = sender.replace('@s.whatsapp.net', '').replace(/[^0-9]/g, '');
    const ownerNumber = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    return senderNumber === ownerNumber;
}

// **SESSION MANAGEMENT**

function isSessionActive(number) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const health = sessionHealth.get(sanitizedNumber);
    const connectionStatus = sessionConnectionStatus.get(sanitizedNumber);
    const socket = activeSockets.get(sanitizedNumber);

    return (
        connectionStatus === 'open' &&
        health === 'active' &&
        socket &&
        socket.user &&
        !disconnectionTime.has(sanitizedNumber)
    );
}

async function saveSessionLocally(number, sessionData) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');

        if (!isSessionActive(sanitizedNumber)) {
            console.log(`⏭️ Skipping local save for inactive session: ${sanitizedNumber}`);
            return false;
        }

        const sessionPath = path.join(config.SESSION_BASE_PATH, `session_${sanitizedNumber}`);

        fs.ensureDirSync(sessionPath);

        fs.writeFileSync(
            path.join(sessionPath, 'creds.json'),
            JSON.stringify(sessionData, null, 2)
        );

        console.log(`💾 Active session saved locally: ${sanitizedNumber}`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to save session locally for ${number}:`, error);
        return false;
    }
}

async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');

        // Try MongoDB
        const sessionData = await loadSessionFromMongoDB(sanitizedNumber);
        
        if (sessionData) {
            // Save to local for running bot
            await saveSessionLocally(sanitizedNumber, sessionData);
            console.log(`✅ Restored session from MongoDB: ${sanitizedNumber}`);
            return sessionData;
        }

        return null;
    } catch (error) {
        console.error(`❌ Session restore failed for ${number}:`, error.message);
        return null;
    }
}

async function deleteSessionImmediately(number) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');

    console.log(`🗑️ Immediately deleting inactive/invalid session: ${sanitizedNumber}`);

    // Delete local files
    const sessionPath = path.join(config.SESSION_BASE_PATH, `session_${sanitizedNumber}`);
    if (fs.existsSync(sessionPath)) {
        fs.removeSync(sessionPath);
        console.log(`🗑️ Deleted session directory: ${sanitizedNumber}`);
    }

    // Delete from MongoDB
    await deleteSessionFromMongoDB(sanitizedNumber);

    // Clear all references
    pendingSaves.delete(sanitizedNumber);
    sessionConnectionStatus.delete(sanitizedNumber);
    disconnectionTime.delete(sanitizedNumber);
    sessionHealth.delete(sanitizedNumber);
    reconnectionAttempts.delete(sanitizedNumber);
    socketCreationTime.delete(sanitizedNumber);
    lastBackupTime.delete(sanitizedNumber);
    restoringNumbers.delete(sanitizedNumber);
    activeSockets.delete(sanitizedNumber);

    await updateSessionStatus(sanitizedNumber, 'deleted', new Date().toISOString());

    console.log(`✅ Successfully deleted all data for inactive session: ${sanitizedNumber}`);
}

// **AUTO MANAGEMENT FUNCTIONS**

function initializeAutoManagement() {
    console.log('🔄 Starting optimized auto management with MongoDB...');

    // Initialize MongoDB
    initializeMongoDB().then(() => {
        // Start initial restore after MongoDB is connected
        setTimeout(async () => {
            console.log('🔄 Initial auto-restore on startup...');
            await autoRestoreAllSessions();
        }, config.INITIAL_RESTORE_DELAY);
    });

    autoSaveInterval = setInterval(async () => {
        console.log('💾 Auto-saving active sessions...');
        await autoSaveAllActiveSessions();
    }, config.AUTO_SAVE_INTERVAL);

    mongoSyncInterval = setInterval(async () => {
        console.log('🔄 Syncing active sessions with MongoDB...');
        await syncPendingSavesToMongoDB();
    }, config.MONGODB_SYNC_INTERVAL);

    autoCleanupInterval = setInterval(async () => {
        console.log('🧹 Auto-cleaning inactive sessions...');
        await autoCleanupInactiveSessions();
    }, config.AUTO_CLEANUP_INTERVAL);

    autoReconnectInterval = setInterval(async () => {
        console.log('🔗 Auto-checking reconnections...');
        await autoReconnectFailedSessions();
    }, config.AUTO_RECONNECT_INTERVAL);

    autoRestoreInterval = setInterval(async () => {
        console.log('🔄 Hourly auto-restore check...');
        await autoRestoreAllSessions();
    }, config.AUTO_RESTORE_INTERVAL);
}

setInterval(async () => {
    try {
        const files = fs.readdirSync('./setting').filter(f => f.endsWith('.json'));
        for (const file of files) {
            const number = file.replace('.json', '');
            const localPath = `./setting/${file}`;
            const localConfig = JSON.parse(fs.readFileSync(localPath, 'utf8'));

            // Load from MongoDB
            const dbConfig = await loadUserConfigFromMongoDB(number);
            if (!dbConfig) continue;

            // If DB updated → overwrite local
            if (new Date(dbConfig.updatedAt || 0) > fs.statSync(localPath).mtime) {
                fs.writeFileSync(localPath, JSON.stringify(dbConfig, null, 2));
                console.log(`🔁 Synced updated MongoDB config → local for ${number}`);
            }

            // If local changed → push to DB (optional)
            // await saveUserConfigToMongoDB(number, localConfig);
        }
    } catch (e) {
        console.error('⚠️ Auto-sync user configs failed:', e.message);
    }
}, 10 * 60 * 1000); // Every 10 minutes


async function syncPendingSavesToMongoDB() {
    if (pendingSaves.size === 0) {
        console.log('✅ No pending saves to sync with MongoDB');
        return;
    }

    console.log(`🔄 Syncing ${pendingSaves.size} pending saves to MongoDB...`);
    let successCount = 0;
    let failCount = 0;

    for (const [number, sessionInfo] of pendingSaves) {
        if (!isSessionActive(number)) {
            console.log(`⏭️ Session became inactive, skipping: ${number}`);
            pendingSaves.delete(number);
            continue;
        }

        try {
            const success = await saveSessionToMongoDB(number, sessionInfo.data);
            if (success) {
                pendingSaves.delete(number);
                successCount++;
            } else {
                failCount++;
            }
            await delay(500);
        } catch (error) {
            console.error(`❌ Failed to save ${number} to MongoDB:`, error.message);
            failCount++;
        }
    }

    console.log(`✅ MongoDB sync completed: ${successCount} saved, ${failCount} failed, ${pendingSaves.size} pending`);
}

async function autoSaveAllActiveSessions() {
    try {
        let savedCount = 0;
        let skippedCount = 0;

        for (const [number, socket] of activeSockets) {
            if (isSessionActive(number)) {
                const success = await autoSaveSession(number);
                if (success) {
                    savedCount++;
                } else {
                    skippedCount++;
                }
            } else {
                console.log(`⏭️ Skipping save for inactive session: ${number}`);
                skippedCount++;
                await deleteSessionImmediately(number);
            }
        }

        console.log(`✅ Auto-save completed: ${savedCount} active saved, ${skippedCount} skipped/deleted`);
    } catch (error) {
        console.error('❌ Auto-save all sessions failed:', error);
    }
}

async function autoSaveSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');

        if (!isSessionActive(sanitizedNumber)) {
            console.log(`⏭️ Not saving inactive session: ${sanitizedNumber}`);
            return false;
        }

        const sessionPath = path.join(config.SESSION_BASE_PATH, `session_${sanitizedNumber}`);
        const credsPath = path.join(sessionPath, 'creds.json');

        if (fs.existsSync(credsPath)) {
            const fileContent = await fs.readFile(credsPath, 'utf8');
            const credData = JSON.parse(fileContent);

            // Save to MongoDB
            await saveSessionToMongoDB(sanitizedNumber, credData);
            
            // Update status
            await updateSessionStatusInMongoDB(sanitizedNumber, 'active', 'active');
            await updateSessionStatus(sanitizedNumber, 'active', new Date().toISOString());

            return true;
        }
        return false;
    } catch (error) {
        console.error(`❌ Failed to auto-save session for ${number}:`, error);
        return false;
    }
}

async function autoCleanupInactiveSessions() {
    try {
        const sessionStatus = await loadSessionStatus();
        let cleanedCount = 0;

        // Check local active sockets
        for (const [number, socket] of activeSockets) {
            const isActive = isSessionActive(number);
            const status = sessionStatus[number]?.status || 'unknown';
            const disconnectedTimeValue = disconnectionTime.get(number);

            const shouldDelete =
                !isActive ||
                (disconnectedTimeValue && (Date.now() - disconnectedTimeValue > config.DISCONNECTED_CLEANUP_TIME)) ||
                ['failed', 'invalid', 'max_attempts_reached', 'deleted', 'disconnected'].includes(status);

            if (shouldDelete) {
                await deleteSessionImmediately(number);
                cleanedCount++;
            }
        }

        // Clean MongoDB inactive sessions
        const mongoCleanedCount = await cleanupInactiveSessionsFromMongoDB();
        cleanedCount += mongoCleanedCount;

        console.log(`✅ Auto-cleanup completed: ${cleanedCount} inactive sessions cleaned`);
    } catch (error) {
        console.error('❌ Auto-cleanup failed:', error);
    }
}

async function autoReconnectFailedSessions() {
    try {
        const sessionStatus = await loadSessionStatus();
        let reconnectCount = 0;

        for (const [number, status] of Object.entries(sessionStatus)) {
            if (status.status === 'failed' && !activeSockets.has(number) && !restoringNumbers.has(number)) {
                const attempts = reconnectionAttempts.get(number) || 0;
                const disconnectedTimeValue = disconnectionTime.get(number);

                if (disconnectedTimeValue && (Date.now() - disconnectedTimeValue > config.DISCONNECTED_CLEANUP_TIME)) {
                    console.log(`⏭️ Deleting long-disconnected session: ${number}`);
                    await deleteSessionImmediately(number);
                    continue;
                }

                if (attempts < config.MAX_FAILED_ATTEMPTS) {
                    console.log(`🔄 Auto-reconnecting ${number} (attempt ${attempts + 1})`);
                    reconnectionAttempts.set(number, attempts + 1);
                    restoringNumbers.add(number);

                    const mockRes = {
                        headersSent: false,
                        send: () => { },
                        status: () => mockRes
                    };

                    await EmpirePair(number, mockRes);
                    reconnectCount++;
                    await delay(5000);
                } else {
                    console.log(`❌ Max reconnection attempts reached, deleting ${number}`);
                    await deleteSessionImmediately(number);
                }
            }
        }

        console.log(`✅ Auto-reconnect completed: ${reconnectCount} sessions reconnected`);
    } catch (error) {
        console.error('❌ Auto-reconnect failed:', error);
    }
}

async function autoRestoreAllSessions() {
    try {
        if (!mongoConnected) {
            console.log('⚠️ MongoDB not connected, skipping auto-restore');
            return { restored: [], failed: [] };
        }

        console.log('🔄 Starting auto-restore process from MongoDB...');
        const restoredSessions = [];
        const failedSessions = [];

        // Get all active sessions from MongoDB
        const mongoSessions = await getAllActiveSessionsFromMongoDB();

        for (const session of mongoSessions) {
            const number = session.number;

            if (activeSockets.has(number) || restoringNumbers.has(number)) {
                continue;
            }

            try {
                console.log(`🔄 Restoring session from MongoDB: ${number}`);
                restoringNumbers.add(number);

                // Save to local for running bot
                await saveSessionLocally(number, session.sessionData);

                const mockRes = {
                    headersSent: false,
                    send: () => { },
                    status: () => mockRes
                };

                await EmpirePair(number, mockRes);
                restoredSessions.push(number);

                await delay(3000);
            } catch (error) {
                console.error(`❌ Failed to restore session ${number}:`, error.message);
                failedSessions.push(number);
                restoringNumbers.delete(number);
                
                // Update status in MongoDB
                await updateSessionStatusInMongoDB(number, 'failed', 'disconnected');
            }
        }

        console.log(`✅ Auto-restore completed: ${restoredSessions.length} restored, ${failedSessions.length} failed`);

        if (restoredSessions.length > 0) {
            console.log(`✅ Restored sessions: ${restoredSessions.join(', ')}`);
        }

        if (failedSessions.length > 0) {
            console.log(`❌ Failed sessions: ${failedSessions.join(', ')}`);
        }

        return { restored: restoredSessions, failed: failedSessions };
    } catch (error) {
        console.error('❌ Auto-restore failed:', error);
        return { restored: [], failed: [] };
    }
}

async function updateSessionStatus(number, status, timestamp, extra = {}) {
    try {
        const sessionStatus = await loadSessionStatus();
        sessionStatus[number] = {
            status,
            timestamp,
            ...extra
        };
        await saveSessionStatus(sessionStatus);
    } catch (error) {
        console.error('❌ Failed to update session status:', error);
    }
}

async function loadSessionStatus() {
    try {
        if (fs.existsSync(config.SESSION_STATUS_PATH)) {
            return JSON.parse(fs.readFileSync(config.SESSION_STATUS_PATH, 'utf8'));
        }
        return {};
    } catch (error) {
        console.error('❌ Failed to load session status:', error);
        return {};
    }
}

async function saveSessionStatus(sessionStatus) {
    try {
        fs.writeFileSync(config.SESSION_STATUS_PATH, JSON.stringify(sessionStatus, null, 2));
    } catch (error) {
        console.error('❌ Failed to save session status:', error);
    }
}

// **USER CONFIG MANAGEMENT**

async function loadUserConfig(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const localPath = `./setting/${sanitizedNumber}.json`;

        // 1️⃣ Try to load from local JSON
        if (fs.existsSync(localPath)) {
            const localConfig = JSON.parse(fs.readFileSync(localPath, 'utf8'));
            console.log(`💾 Loaded local config for ${sanitizedNumber}`);
            applyConfigSettings(localConfig);
            return localConfig;
        }

        // 2️⃣ Fallback: Load from MongoDB
        const loadedConfig = await loadUserConfigFromMongoDB(sanitizedNumber);

        if (loadedConfig) {
            fs.writeFileSync(localPath, JSON.stringify(loadedConfig, null, 2));
            console.log(`✅ Saved MongoDB config locally for ${sanitizedNumber}`);
            applyConfigSettings(loadedConfig);
            return loadedConfig;
        }

        // 3️⃣ If nothing found → use default config
        console.warn(`⚠️ No config found for ${sanitizedNumber}, using defaults`);
        fs.writeFileSync(localPath, JSON.stringify(config, null, 2));
        await saveUserConfigToMongoDB(sanitizedNumber, config);
        return { ...config };
    } catch (error) {
        console.error(`❌ loadUserConfig failed for ${number}:`, error);
        return { ...config };
    }
}

function applyConfigSettings(loadedConfig) {
    if (loadedConfig.NEWSLETTER_JIDS) {
        config.NEWSLETTER_JIDS = loadedConfig.NEWSLETTER_JIDS;
    }
    if (loadedConfig.NEWSLETTER_REACT_EMOJIS) {
        config.NEWSLETTER_REACT_EMOJIS = loadedConfig.NEWSLETTER_REACT_EMOJIS;
    }
    if (loadedConfig.AUTO_REACT_NEWSLETTERS !== undefined) {
        config.AUTO_REACT_NEWSLETTERS = loadedConfig.AUTO_REACT_NEWSLETTERS;
    }
}

async function updateUserConfig(number, newConfig) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');

        if (!isSessionActive(sanitizedNumber)) {
            console.log(`⏭️ Not saving config for inactive session: ${sanitizedNumber}`);
            return;
        }

        // Save to MongoDB
        await saveUserConfigToMongoDB(sanitizedNumber, newConfig);
        
        console.log(`✅ Config updated in MongoDB: ${sanitizedNumber}`);
    } catch (error) {
        console.error('❌ Failed to update config:', error);
        throw error;
    }
}

// **HELPER FUNCTIONS**

function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('❌ Failed to load admin list:', error);
        return [];
    }
}

function formatMessage(title, content, footer) {
    return `${title}\n\n${content}\n\n${footer}`;
}

function getSriLankaTimestamp() {
    return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
}

async function sendAdminConnectMessage(socket, number) {
    const admins = loadAdmins();

    const caption = formatMessage(
        '*𝑆𝐻𝜟Ꮹ𝛯𝛯 Whatsapp Bot Connected*',
        `Connect - ${mainSite}\n\n📞 Number: ${number}\n🟢 Status: Auto-Connected\n⏰ Time: ${getSriLankaTimestamp()}`,
        `${footer}`
    );

    for (const admin of admins) {
        try {
            await socket.sendMessage(
                `${admin}@s.whatsapp.net`,
                {
                    image: { url: logo },
                    caption
                }
            );
        } catch (error) {
            console.error(`❌ Failed to send admin message to ${admin}:`, error);
        }
    }
}

async function handleUnknownContact(socket, number, messageJid) {
    return; // Do nothing
}

async function updateAboutStatus(socket) {
    const aboutStatus = ' һ𝖊𝑦 𝘣𝖊𝘣𝑦 ⅈ ｍ һ𝖊ɑ𝔯...♥︎';
    try {
        await socket.updateProfileStatus(aboutStatus);
        console.log(`✅ Auto-updated About status`);
    } catch (error) {
        console.error('❌ Failed to update About status:', error);
    }
}

// **MEDIA FUNCTIONS**

async function resize(image, width, height) {
    let oyy = await Jimp.read(image);
    let kiyomasa = await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
    return kiyomasa;
}

function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const createSerial = (size) => {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
}

const myquoted = {
    key: {
        remoteJid: 'status@broadcast',
        participant: '0@s.whatsapp.net',
        fromMe: false,
        id: createSerial(16).toUpperCase()
    },
    message: {
        contactMessage: {
            displayName: "Ｄ𝞔𝓦 𝘚Η𝔸ɢ𝞔𝞔 l ꙰╰_╯",
            vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:𝑆𝐻𝜟Ꮹ𝛯𝛯𝛭𝐷\nORG:SHAGEE Coders;\nTEL;type=CELL;type=VOICE;waid=13135550002:13135550002\nEND:VCARD`,
            contextInfo: {
                stanzaId: createSerial(16).toUpperCase(),
                participant: "0@s.whatsapp.net",
                quotedMessage: {
                    conversation: "SHAGEE AI"
                }
            }
        }
    },
    messageTimestamp: Math.floor(Date.now() / 1000),
    status: 1,
    verifiedBizName: "Meta"
};

async function SendSlide(socket, jid, newsItems) {
    let anu = [];
    for (let item of newsItems) {
        let imgBuffer;
        try {
            imgBuffer = await resize(item.thumbnail, 300, 200);
        } catch (error) {
            console.error(`❌ Failed to resize image for ${item.title}:`, error);
            imgBuffer = await Jimp.read('https://files.catbox.moe/0k6zv8.jpg');
            imgBuffer = await imgBuffer.resize(300, 200).getBufferAsync(Jimp.MIME_JPEG);
        }
        let imgsc = await prepareWAMessageMedia({ image: imgBuffer }, { upload: socket.waUploadToServer });
        anu.push({
            body: proto.Message.InteractiveMessage.Body.fromObject({
                text: `*${capital(item.title)}*\n\n${item.body}`
            }),
            header: proto.Message.InteractiveMessage.Header.fromObject({
                hasMediaAttachment: true,
                ...imgsc
            }),
            nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                buttons: [
                    {
                        name: "cta_url",
                        buttonParamsJson: `{"display_text":"𝐃𝙴𝙿𝙻𝙾𝚈","url":"https:/","merchant_url":"https://www.google.com"}`
                    },
                    {
                        name: "cta_url",
                        buttonParamsJson: `{"display_text":"𝐂𝙾𝙽𝚃𝙰𝙲𝚃","url":"https","merchant_url":"https://www.google.com"}`
                    }
                ]
            })
        });
    }
    const msgii = await generateWAMessageFromContent(jid, {
        viewOnceMessage: {
            message: {
                messageContextInfo: {
                    deviceListMetadata: {},
                    deviceListMetadataVersion: 2
                },
                interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                    body: proto.Message.InteractiveMessage.Body.fromObject({
                        text: "*AUTO NEWS UPDATES*"
                    }),
                    carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.fromObject({
                        cards: anu
                    })
                })
            }
        }
    }, { userJid: jid });
    return socket.relayMessage(jid, msgii.message, {
        messageId: msgii.key.id
    });
}

// **EVENT HANDLERS**

function setupNewsletterHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key) return;

        const isNewsletter = config.NEWSLETTER_JIDS.some(jid =>
            message.key.remoteJid === jid ||
            message.key.remoteJid?.includes(jid)
        );

        if (!isNewsletter || config.AUTO_REACT_NEWSLETTERS !== 'true') return;

        try {
            const randomEmoji = config.NEWSLETTER_REACT_EMOJIS[
                Math.floor(Math.random() * config.NEWSLETTER_REACT_EMOJIS.length)
            ];
            const messageId = message.newsletterServerId;

            if (!messageId) {
                console.warn('⚠️ No valid newsletterServerId found for newsletter:', message.key.remoteJid);
                return;
            }

            let retries = config.MAX_RETRIES;
            while (retries > 0) {
                try {
                    await socket.newsletterReactMessage(
                        message.key.remoteJid,
                        messageId.toString(),
                        randomEmoji
                    );
                    console.log(`✅ Auto-reacted to newsletter ${message.key.remoteJid}: ${randomEmoji}`);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`⚠️ Newsletter reaction failed for ${message.key.remoteJid}, retries: ${retries}`);
                    if (retries === 0) {
                        console.error(`❌ Failed to react to newsletter ${message.key.remoteJid}:`, error.message);
                    }
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
        } catch (error) {
            console.error('❌ Newsletter reaction error:', error);
        }
    });
}

async function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant) return;

        try {
            if (config.AUTO_RECORDING === 'true' && message.key.remoteJid) {
                await socket.sendPresenceUpdate("recording", message.key.remoteJid);
            }

            if (config.AUTO_VIEW_STATUS === 'true') {
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.readMessages([message.key]);
                        console.log('👁️ Auto-viewed status');
                        break;
                    } catch (error) {
                        retries--;
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }

            if (config.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.sendMessage(
                            message.key.remoteJid,
                            { react: { text: randomEmoji, key: message.key } },
                            { statusJidList: [message.key.participant] }
                        );
                        console.log(`Reacted to status with ${randomEmoji}`);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to react to status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }
        } catch (error) {
            console.error('Status handler error:', error);
        }
    });
}

async function setupStatusSavers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];

        try {
            // ==== Detect reply to status from anyone ====
            if (message.message?.extendedTextMessage?.contextInfo) {
                const replyText = message.message.extendedTextMessage.text?.trim().toLowerCase();
                const quotedInfo = message.message.extendedTextMessage.contextInfo;

                // Check if reply matches translations & is to a status
                if (
                    sendTranslations.includes(replyText) &&
                    quotedInfo?.participant?.endsWith('@s.whatsapp.net') &&
                    quotedInfo?.remoteJid === "status@broadcast"
                ) {
                    const senderJid = message.key?.remoteJid;
                    if (!senderJid || !senderJid.includes('@')) return;

                    const quotedMsg = quotedInfo.quotedMessage;
                    const originalMessageId = quotedInfo.stanzaId;

                    if (!quotedMsg || !originalMessageId) {
                        console.warn("Skipping send: Missing quotedMsg or stanzaId");
                        return;
                    }

                    const mediaType = Object.keys(quotedMsg || {})[0];
                    if (!mediaType || !quotedMsg[mediaType]) return;

                    // Extract caption
                    let statusCaption = "";
                    if (quotedMsg[mediaType]?.caption) {
                        statusCaption = quotedMsg[mediaType].caption;
                    } else if (quotedMsg?.conversation) {
                        statusCaption = quotedMsg.conversation;
                    }

                    // Download media
                    const stream = await downloadContentFromMessage(
                        quotedMsg[mediaType],
                        mediaType.replace("Message", "")
                    );
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }
                    const savetex = '*SHAGEE-MD-STATUS-SAVER*'
                    // Send via bot
                    if (mediaType === "imageMessage") {
                        await socket.sendMessage(senderJid, { image: buffer, caption: `${savetex}\n\n${statusCaption || ""}` });
                    } else if (mediaType === "videoMessage") {
                        await socket.sendMessage(senderJid, { video: buffer, caption: `${savetex}\n\n${statusCaption || ""}` });
                    } else if (mediaType === "audioMessage") {
                        await socket.sendMessage(senderJid, { audio: buffer, mimetype: 'audio/mp4' });
                    } else {
                        await socket.sendMessage(senderJid, { text: `${savetex}\n\n${statusCaption || ""}` });
                    }

                    console.log(`✅ Status from ${quotedInfo.participant} saved & sent to ${senderJid}`);
                }
            }
        } catch (error) {
            console.error('Status save handler error:', error);
        }
    });
}



// **COMMAND HANDLERS**

function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const userConfig = await loadUserConfig(number);
        const msg = messages[0];
        const m = sms(socket, msg);
        const from = msg.key.remoteJid;
        const prefix = userConfig.PREFIX || '.';
        const pushname = msg.pushName || 'User';
        const isNewsletter = config.NEWSLETTER_JIDS.includes(msg.key?.remoteJid);

        const contextInfo = {
            mentionedJid: [m.sender],
            forwardingScore: 999,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: '120363421350428668@newsletter',
                newsletterName: '⏤ ͟͞ ❮❮⛩️̶͟͞🔥⃝𝑆𝐻𝜟Ꮹ𝛯𝛯 𝛭𝐼𝚴𝐼 𝛣𝛩亇🕊️̶͟͞🌙ヤ',
                serverMessageId: 143
            }
        }; 
        const contextInfo2 = {
            mentionedJid: [m.sender],
            forwardingScore: 999,
            isForwarded: true
        };

        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || isNewsletter) return;

        let command = null;
        let args = [];
        let sender = msg.key.remoteJid;

        if (msg.message.conversation || msg.message.extendedTextMessage?.text) {
            const text = (msg.message.conversation || msg.message.extendedTextMessage.text || '').trim();
            if (text.startsWith(prefix)) {
                const parts = text.slice(prefix.length).trim().split(/\s+/);
                command = parts[0].toLowerCase();
                args = parts.slice(1);
            }
        }
        else if (msg.message.buttonsResponseMessage) {
            const buttonId = msg.message.buttonsResponseMessage.selectedButtonId;
            if (buttonId && buttonId.startsWith(prefix)) {
                const parts = buttonId.slice(prefix.length).trim().split(/\s+/);
                command = parts[0].toLowerCase();
                args = parts.slice(1);
            }
        }

        if (!command) return;

        try {
            switch (command) {

                case 'alive': {                       
                    const userConfig = await loadUserConfig(number);
                    const useButton = userConfig.BUTTON === 'true'; // default false
                    try {
                        const captionText = `> 𝘚Η𝔸ɢ𝞔𝞔 ᎷＤ ᎷƖ𝑵Ɩ.𝗕૦𝚃 🖤

> ╭─「 ꜱᴛᴀᴛᴜꜱ ᴅᴇᴛᴀɪʟꜱ 」
> │♠️ \`Bot Name\`: \`𝘚Η𝔸ɢ𝞔𝞔 ᎷＤ\` 
> │♠️ \`Owner\`:  \`ＤƖ𝑵𝞔𝚃Η\`
> │♠️ \`Prefix\`: \`${prefix}\`
> ╰──────────●●►

> \`| © 𝘚Η𝔸ɢ𝞔𝞔 &Ｄ𝞔𝓦 𝚃𝞔𝔸Ꮇ\`
╭──────────●●►
│ *Main Site* - ${mainSite}
╰──────────●●►

${footer}`;

        if (useButton) {
            // Send button style alive
            const buttonMessage = {
                image: { url: logo },
                caption: captionText,
                buttons: [
                    { buttonId: `${prefix}ping`, buttonText: { displayText: "𝚙ⅈ𝖓𝓰" }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: "ｍ𝖊𝖓𝗎" }, type: 1 }
                ],
                headerType: 1
            };
            await socket.sendMessage(sender, buttonMessage, { quoted: myquoted });
        } else {
            // Normal alive message
            await socket.sendMessage(sender, {
                image: { url: logo },
                caption: captionText
            }, { quoted: myquoted });
        }
    } catch (err) {
        console.error("Alive command error:", err);
        await socket.sendMessage(sender, { text: "❌ Error while running alive command" });
    }
    break;
}

// Menu Command - shows all commands in a button menu or text format - Last Update 2025-August-14
case 'menu': {
    const userConfig = await loadUserConfig(number);                
    const useButton = userConfig.BUTTON === 'true'; // default false
    // React to the menu command
    await socket.sendMessage(sender, {
        react: {
            text: '📜',
            key: msg.key
        }
    });

    // Commands list grouped by category
    const commandsInfo = {
        download: [
            { name: 'song', description: 'Download Songs' },
            { name: 'video', description: 'Download Videos'},
            { name: 'tiktok', description: 'Download TikTok video' },
            { name: 'img', description: 'Download Images' },
            { name: 'fb', description: 'Download Facebook video' },
            { name: 'ig', description: 'Download Instagram video' },
            { name: 'ts', description: 'Search TikTok videos' },
            { name: 'yts', description: 'Search YouTube videos' },
            { name: 'xvdl', description: 'Download Xvideos' },
            { name: 'ph', description: 'Download Pornhub videos' },
        ],
        main: [
            { name: 'alive', description: 'Show bot status' },
            { name: 'menu', description: 'Show all commands' },
            { name: 'ping', description: 'Get bot speed' },
            { name: 'freebot', description: 'Setup Free Bot' },
            { name: 'owner', description: 'Contact Bot Owner' },
            { name: 'getdp', description: 'Get Profile Picture' },
            { name: 'logo', description: 'Create Logo' },
            { name: 'fancy', description: 'View Fancy Text' },
            { name: 'winfo', description: 'Get User Profile Picture' },
            { name: 'cid', description: 'Get Channel ID' },
        ],
        owner: [
            { name: 'deleteme', description: 'Delete your session' },
            { name: 'fc', description: 'Follow newsletter channel' },
            { name: 'set', description: 'Set Setting Using Env' },
            { name: 'setting', description: 'Setup YouOwn Setting' },
            { name: 'jid', description: 'Get JID of a number' },
        ],
        group: [
            { name: 'bomb', description: 'Send Bomb Message' },
        ],
         ai: [
            { name: 'aiimg', description: 'Generate AI Image' },
        ],
    };

    // Build sections for button menu
    const sections = Object.entries(commandsInfo).map(([category, cmds]) => ({
        title: category.toUpperCase() + ' CMD',
        rows: cmds.map(cmd => ({
            title: cmd.name,
            description: cmd.description,
            id: prefix + cmd.name,
        })),
    }));

    // Menu captions
    const menuCaption = `> 𝘚Η𝔸ɢ𝞔𝞔 ᎷＤ ᎷƖ𝑵Ɩ.𝗕૦𝚃 🖤

> ╭─「 ꜱᴛᴀᴛᴜꜱ ᴅᴇᴛᴀɪʟꜱ 」
> │♠️ \`Bot Name\`: \`𝘚Η𝔸ɢ𝞔𝞔 ᎷＤ\` 
> │♠️ \`Owner\`:  \`ＤƖ𝑵𝞔𝚃Η\`
> │♠️ \`Prefix\`: \`${prefix}\`
> ╰──────────●●►

> \`| © 𝘚Η𝔸ɢ𝞔𝞔 &Ｄ𝞔𝓦 𝚃𝞔𝔸Ꮇ\`
╭──────────●●►
│ *Main Site* - ${mainSite}
╰──────────●●►

${footer}`;
    const menuCaption2 = `> 𝘚Η𝔸ɢ𝞔𝞔 ᎷＤ ᎷƖ𝑵Ɩ.𝗕૦𝚃 🖤

> ╭─「 ꜱᴛᴀᴛᴜꜱ ᴅᴇᴛᴀɪʟꜱ 」
> │♠️ \`Bot Name\`: \`𝘚Η𝔸ɢ𝞔𝞔 ᎷＤ\` 
> │♠️ \`Owner\`:  \`ＤƖ𝑵𝞔𝚃Η\`
> │♠️ \`Prefix\`: \`${prefix}\`
> ╰──────────●●►

> \`| © 𝘚Η𝔸ɢ𝞔𝞔 &Ｄ𝞔𝓦 𝚃𝞔𝔸Ꮇ\``;

    // Button menu
    if (useButton) {
        await socket.sendMessage(from, {
            image: { url: logo },
            caption: menuCaption,
            buttons: [
                {
                    buttonId: 'action',
                    buttonText: { displayText: '📂 Menu Options' },
                    type: 4,
                    nativeFlowInfo: {
                        name: 'single_select',
                        paramsJson: JSON.stringify({
                            title: 'Commands Menu ❏',
                            sections: sections,
                        }),
                    },
                },
            ],
            headerType: 1,
            viewOnce: true,
            contextInfo: contextInfo2
        }, { quoted: myquoted });

    // Normal image + caption menu
    } else {
        // Build plain text list of commands grouped by category
        let fullMenu = `${menuCaption2}`;
        for (const [category, cmds] of Object.entries(commandsInfo)) {
            fullMenu += `\n> ${category.toUpperCase()} COMMANDS\n`;
            fullMenu += `*╭──────────●●►*\n`;
            fullMenu += cmds.map(c => `*│*❯❯◦ ${c.name} — ${c.description}`).join('\n');
            fullMenu += `\n*╰───────────●●►*`;
        }

        await socket.sendMessage(sender, { 
            image: { url: logo }, 
            caption: fullMenu+`\n\n${footer}`, 
            contextInfo 
        }, { quoted: myquoted });
    }

    break;
}

// Logo Maker Command - Button Selection
case 'logo': {
    const userConfig = await loadUserConfig(number);                
    const useButton = userConfig.BUTTON === 'true'; // default false
    const q = args.join(" ");
    if (!q || q.trim() === '') {
        return await socket.sendMessage(sender, { text: '*`Need a name for logo`*' });
    }

    await socket.sendMessage(sender, { react: { text: '⬆️', key: msg.key } });

    const list = require('./data/logo.json'); // JSON with all 50 logo styles

    const rows = list.map(v => ({
        title: v.name,
        description: 'Tap to generate logo',
        id: `${prefix}dllogo ${encodeURIComponent(v.url)} ${encodeURIComponent(q)}` // pass URL and text
    }));

    const buttonMessage = {
        buttons: [
            {
                buttonId: 'action',
                buttonText: { displayText: '🎨 Select Text Effect' },
                type: 4,
                nativeFlowInfo: {
                    name: 'single_select',
                    paramsJson: JSON.stringify({
                        title: 'Available Text Effects',
                        sections: [
                            {
                                title: 'Choose your logo style',
                                rows
                            }
                        ]
                    })
                }
            }
        ],
        headerType: 1,
        viewOnce: true,
        caption: `❏ *LOGO MAKER*\nReply a style to generate a logo for: *${q}*`,
        image: { url: logo },
    };
    if(useButton){
    await socket.sendMessage(from, buttonMessage, { quoted: msg });

} else {

    await socket.sendMessage(sender, { react: { text: '⬆️', key: msg.key } });

    let messageText = `🔢 Reply with the number for the *${q}* logo:\n\n`;

    list.forEach((v, i) => {
        messageText += `${i + 1} │❯❯◦ ${v.name}\n`;
    });

    const fetchLogoUrl = async (url, name) => {
        try {
            const response = await axios.get(`https://api-pink-venom.vercel.app/api/logo`, {
                params: { url, name }
            });
            return response.data.result.download_url;
        } catch (error) {
            console.error("Error fetching logo:", error);
            return null;
        }
    };

    messageText += `\n*Reply with a number (1-${list.length})*`;

    const sentMessage = await socket.sendMessage(from, { 
        image: { url: logo },
        caption: messageText }, 
        { quoted: msg });

    // Listen for user's reply
    const handler = async ({ messages }) => {
        const message = messages[0];
        if (!message.message?.extendedTextMessage) return;

        const replyText = message.message.extendedTextMessage.text.trim();
        const context = message.message.extendedTextMessage.contextInfo;

        // Only respond if replying to our menu message
        if (context?.stanzaId !== sentMessage.key.id) return;

        const index = parseInt(replyText);
        if (isNaN(index) || index < 1 || index > list.length) {
            return await socket.sendMessage(from, { text: `❌ Invalid number! Please reply with 1-${list.length}` }, { quoted: message });
        }

        const logo = list[index - 1];

        // Fetch logo using your helper
        const logoUrl = await fetchLogoUrl(logo.url, q);
        if (!logoUrl) {
            return await socket.sendMessage(from, { text: `❌ Failed to generate logo.` }, { quoted: message });
        }

        await socket.sendMessage(from, {
            image: { url: logoUrl },
            caption: `✨ Here’s your *${q}* logo\n\n${footer}`
        }, { quoted: message });

        // Remove listener after first valid reply
        socket.ev.off('messages.upsert', handler);
    };

    socket.ev.on('messages.upsert', handler);
        
}
    break;
}

// DLL Logo - Download the logo after selection
case 'dllogo': {
    if (args.length < 2) return reply("❌ Usage: dllogo <URL> <text>");

    const [url, ...nameParts] = args;
    const text = decodeURIComponent(nameParts.join(" "));
    const fetchLogoUrl = async (url, name) => {
        try {
            const response = await axios.get(`https://api-pink-venom.vercel.app/api/logo`, {
                params: { url, name }
            });
            return response.data.result.download_url;
        } catch (error) {
            console.error("Error fetching logo:", error);
            return null;
        }
    };
    try {
        const logoUrl = await fetchLogoUrl(decodeURIComponent(url), text);
        if (!logoUrl) return reply("❌ Failed to generate logo.");

        await socket.sendMessage(from, {
            image: { url: logoUrl },
            caption: `✨ Here’s your logo for *${text}*\n${config.CAPTION}`
        }, { quoted: msg });

    } catch (e) {
        console.log('Logo Download Error:', e);
        await socket.sendMessage(from, { text: `❌ Error:\n${e.message}` }, { quoted: msg });
    }
    break;
}


case 'cinfo':
case 'channelinfo':
case 'cid': {
    try {
        // 🔹 Extract query text from message
        let q = msg.message?.conversation?.split(" ")[1] || 
                msg.message?.extendedTextMessage?.text?.split(" ")[1];

        if (!q) return await socket.sendMessage(sender, { text: "❎ Please provide a WhatsApp Channel link.\n\nUsage: .cid <link>" });

        // 🔹 Extract Channel invite ID from link (flexible regex)
        const match = q.match(/https?:\/\/(www\.)?whatsapp\.com\/channel\/([\w-]+)/i);
        if (!match) return await socket.sendMessage(sender, { text: "⚠️ Invalid channel link!" });

        const inviteId = match[2];

        // 🔹 Fetch Channel Metadata
        let metadata;
        try {
            metadata = await socket.newsletterMetadata("invite", inviteId);
        } catch (err) {
            console.error("❌ Failed to fetch metadata via invite:", err);
            return await socket.sendMessage(sender, { text: "⚠️ Could not fetch channel metadata. Maybe the link is private or invalid." });
        }

        if (!metadata || !metadata.id) {
            return await socket.sendMessage(sender, { text: "❌ Channel not found or inaccessible." });
        }

        // 🔹 Prepare preview image
        let previewUrl = metadata.preview
            ? metadata.preview.startsWith("http") 
                ? metadata.preview 
                : `https://pps.whatsapp.net${metadata.preview}`
            : "https://telegra.ph/file/4cc2712eaba1c5c1488d3.jpg"; // default image

        // 🔹 Format followers and creation date
        const followers = metadata.subscribers?.toLocaleString() || "Unknown";
        const createdDate = metadata.creation_time 
            ? new Date(metadata.creation_time * 1000).toLocaleString("id-ID", { dateStyle: 'medium', timeStyle: 'short' })
            : "Unknown";

        // 🔹 Format message
        const infoMsg = `*乂 ${botName} Channel Info 乂*\n\n`
                      +`🆔 ID: ${metadata.id}\n`
                      +`📌 Name: ${metadata.name || "Unknown"}\n`
                      +`📝 Description: ${metadata.desc?.toString() || "No description"}\n`
                      +`👥 Followers: ${followers}\n`
                      +`📅 Created: ${createdDate}\n\n`
                      +`${footer}`;
        // 🔹 Send message with preview image
        await socket.sendMessage(sender, {
            image: { url: previewUrl },
            caption: infoMsg,
            ...(contextInfo ? { contextInfo } : {})
        }, { quoted: m });

    } catch (e) {
        console.error("❌ CID Command Error:", e);
        await socket.sendMessage(sender, { text: "⚠️ Error fetching channel details." });
    }
    break;
}

case 'follow':
case 'followchannel': {
    try {
        if (!args[0]) {
            return await socket.sendMessage(sender, {
                text: '*❌ Please provide a channel URL or JID*\n\n' +
                      '*Usage:*\n' +
                      '• .follow <channel_url>\n' +
                      '• .follow <channel_jid>\n\n' +
                      '*Example:*\n' +
                      '• .follow https://whatsapp.com/channel/0029VbAua1VK5cDL3AtIEP3I\n' +
                      '• .follow 120363420895783008@newsletter'
            }, { quoted: myquoted });
        }

        const input = args.join(' ').trim();
        let channelJid = '';

        // Check if input is a URL or JID
        if (input.includes('whatsapp.com/channel/')) {
            // Extract channel code from URL
            const channelCodeMatch = input.match(/channel\/([a-zA-Z0-9]+)/);
            if (!channelCodeMatch) {
                return await socket.sendMessage(sender, {
                    text: '*❌ Invalid channel URL format*'
                }, { quoted: myquoted });
            }
            // Convert to potential JID
            channelJid = `${channelCodeMatch[1]}@newsletter`;
        } else if (input.includes('@newsletter')) {
            channelJid = input;
        } else {
            // Assume it's a channel code and add newsletter suffix
            channelJid = `${input}@newsletter`;
        }

        await socket.sendMessage(sender, { react: { text: '➕', key: msg.key } });

        // Try to follow the channel
        try {
            await socket.newsletterFollow(channelJid);
            
            // Add to config if owner
            if (isOwner(sender)) {
                if (!config.NEWSLETTER_JIDS.includes(channelJid)) {
                    config.NEWSLETTER_JIDS.push(channelJid);
                    
                    const userConfig = await loadUserConfig(number);
                    userConfig.NEWSLETTER_JIDS = config.NEWSLETTER_JIDS;
                    await updateUserConfig(number, userConfig);
                }
            }

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
            
            await socket.sendMessage(sender, {
                image: { url: logo },
                caption: formatMessage(
                    '✅ CHANNEL FOLLOWED',
                    `Successfully followed channel!\n\n` +
                    `*Channel JID:* ${channelJid}\n` +
                    `*Auto-React:* ${config.AUTO_REACT_NEWSLETTERS === 'true' ? '✅ Enabled' : '❌ Disabled'}\n` +
                    (isOwner(sender) ? `*Added to auto-react list:* ✅` : ''),
                    '> ⛩️̶͟͞🔥⃝𝑆𝐻𝜟Ꮹ𝛯𝛯 𝛭𝐼𝚴𝐼 𝛣𝛩亇🕊️̶͟͞🌙'
                )
            }, { quoted: myquoted });

        } catch (error) {
            console.error('Follow error:', error);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            
            let errorMessage = 'Failed to follow channel';
            if (error.message.includes('not found')) {
                errorMessage = 'Channel not found or invalid JID';
            } else if (error.message.includes('already')) {
                errorMessage = 'Already following this channel';
            }
            
            await socket.sendMessage(sender, {
                text: `*❌ ${errorMessage}*\n\nTried JID: ${channelJid}`
            }, { quoted: myquoted });
        }

    } catch (error) {
        console.error('❌ Follow command error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ Error:* ${error.message || 'Failed to follow channel'}`
        }, { quoted: myquoted });
    }
    break;
}

case 'unfollow':
case 'unfollowchannel': {
    try {
        if (!args[0]) {
            return await socket.sendMessage(sender, {
                text: '*❌ Please provide a channel URL or JID*\n\n' +
                      '*Usage:*\n' +
                      '• .unfollow <channel_url>\n' +
                      '• .unfollow <channel_jid>'
            }, { quoted: myquoted });
        }

        const input = args.join(' ').trim();
        let channelJid = '';

        // Check if input is a URL or JID
        if (input.includes('whatsapp.com/channel/')) {
            const channelCodeMatch = input.match(/channel\/([a-zA-Z0-9]+)/);
            if (!channelCodeMatch) {
                return await socket.sendMessage(sender, {
                    text: '*❌ Invalid channel URL format*'
                }, { quoted: myquoted });
            }
            channelJid = `${channelCodeMatch[1]}@newsletter`;
        } else if (input.includes('@newsletter')) {
            channelJid = input;
        } else {
            channelJid = `${input}@newsletter`;
        }

        await socket.sendMessage(sender, { react: { text: '➖', key: msg.key } });

        try {
            await socket.newsletterUnfollow(channelJid);
            
            // Remove from config if owner
            if (isOwner(sender)) {
                const index = config.NEWSLETTER_JIDS.indexOf(channelJid);
                if (index > -1) {
                    config.NEWSLETTER_JIDS.splice(index, 1);
                    
                    const userConfig = await loadUserConfig(number);
                    userConfig.NEWSLETTER_JIDS = config.NEWSLETTER_JIDS;
                    await updateUserConfig(number, userConfig);
                }
            }

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
            
            await socket.sendMessage(sender, {
                text: `✅ *Successfully unfollowed channel*\n\n*JID:* ${channelJid}`
            }, { quoted: myquoted });

        } catch (error) {
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, {
                text: `*❌ Failed to unfollow channel*\n\nJID: ${channelJid}`
            }, { quoted: myquoted });
        }

    } catch (error) {
        console.error('❌ Unfollow error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ Error:* ${error.message || 'Failed to unfollow channel'}`
        }, { quoted: myquoted });
    }
    break;
}




                case 'updatecj': {
                    try {
                        // Get current user's config
                        const userConfig = await loadUserConfig(number);

                        // Update newsletter JIDs
                        userConfig.NEWSLETTER_JIDS = [...config.NEWSLETTER_JIDS];
                        userConfig.NEWSLETTER_REACT_EMOJIS = [...config.NEWSLETTER_REACT_EMOJIS];
                        userConfig.AUTO_REACT_NEWSLETTERS = config.AUTO_REACT_NEWSLETTERS;

                        // Save updated config
                        await updateUserConfig(number, userConfig);

                        // Apply settings
                        applyConfigSettings(userConfig);

                        // Auto-follow new newsletters for active session
                        if (activeSockets.has(number)) {
                            const userSocket = activeSockets.get(number);
                            for (const newsletterJid of config.NEWSLETTER_JIDS) {
                                try {
                                    await userSocket.newsletterFollow(newsletterJid);
                                    console.log(`✅ ${number} followed newsletter: ${newsletterJid}`);
                                } catch (error) {
                                    console.warn(`⚠️ ${number} failed to follow ${newsletterJid}: ${error.message}`);
                                }
                            }
                        }

                        // Send success message
                        await socket.sendMessage(sender, {
                            image: { url: logo },
                            caption: formatMessage(
                                '📝 NEWSLETTER CONFIG UPDATE',
                                `Successfully updated your newsletter configuration!\n\n` +
                                `Current Newsletter JIDs:\n${config.NEWSLETTER_JIDS.join('\n')}\n\n` +
                                `Auto-React: ${config.AUTO_REACT_NEWSLETTERS === 'true' ? '✅ Enabled' : '❌ Disabled'}\n` +
                                `React Emojis: ${config.NEWSLETTER_REACT_EMOJIS.join(', ')}`,
                                '> ⛩️̶͟͞🔥⃝𝑆𝐻𝜟Ꮹ𝛯𝛯 𝛭𝐼𝚴𝐼 𝛣𝛩亇🕊️̶͟͞🌙'
                            )
                        }, { quoted: msg });

                    } catch (error) {
                        console.error('❌ Update CJ command failed:', error);
                        await socket.sendMessage(sender, {
                            text: `*❌ Error updating config:*\n${error.message}`
                        }, { quoted: msg });
                    }
                    break;
                }

                case 'jid': {
                    try {
                        let replyJid = '';
                        let caption = '';

                        if (msg.message.extendedTextMessage?.contextInfo?.participant) {
                            replyJid = msg.message.extendedTextMessage.contextInfo.participant;
                        }

                        const mentionedJid = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;

                        caption = formatMessage(
                            '> ⛩️̶͟͞🔥⃝𝑆𝐻𝜟Ꮹ𝛯𝛯 𝛭𝐼𝚴𝐼 𝛣𝛩亇🕊️̶͟͞🌙 𝐉𝐈𝐃 𝐈𝐍𝐅𝐎',
                            `Connect - https://mini-bot-website.vercel.app/\n*Chat JID:* ${sender}\n` +
                            (replyJid ? `*Replied User JID:* ${replyJid}\n` : '') +
                            (mentionedJid?.length ? `*Mentioned JID:* ${mentionedJid.join('\n')}\n` : '') +
                            (msg.key.remoteJid.endsWith('@g.us') ?
                                `*Group JID:* ${msg.key.remoteJid}\n` : '') +
                            `\n*📝 Note:*\n` +
                            `• User JID Format: number@s.whatsapp.net\n` +
                            `• Group JID Format: number@g.us\n` +
                            `• Newsletter JID Format: number@newsletter`,
                            'handler'
                        );

                        await socket.sendMessage(sender, {
                            image: { url: logo },
                            caption: caption,
                            contextInfo: {
                                mentionedJid: mentionedJid || [],
                                forwardingScore: 999,
                                isForwarded: true
                            }
                        }, { quoted: myquoted });

                    } catch (error) {
                        console.error('❌ GetJID error:', error);
                        await socket.sendMessage(sender, {
                            text: '*Error:* Failed to get JID information'
                        }, { quoted: myquoted });
                    }
                    break;
                }

                case 'addnewsletter': {
                    if (!isOwner(sender)) {
                        return await socket.sendMessage(sender, {
                            text: `*❌ This command is only for the owner.*`
                        }, { quoted: msg });
                    }

                    if (!args[0]) {
                        return await socket.sendMessage(sender, {
                            text: '*Please provide a newsletter JID\nExample: .addnewsletter 120363xxxxxxxxxx@newsletter*'
                        }, { quoted: msg });
                    }

                    const newJid = args[0];
                    if (!newJid.endsWith('@newsletter')) {
                        return await socket.sendMessage(sender, {
                            text: '*❌ Invalid JID format. Must end with @newsletter*'
                        }, { quoted: msg });
                    }

                    if (!config.NEWSLETTER_JIDS.includes(newJid)) {
                        config.NEWSLETTER_JIDS.push(newJid);

                        const userConfig = await loadUserConfig(number);
                        userConfig.NEWSLETTER_JIDS = config.NEWSLETTER_JIDS;
                        userConfig.NEWSLETTER_REACT_EMOJIS = config.NEWSLETTER_REACT_EMOJIS;
                        userConfig.AUTO_REACT_NEWSLETTERS = config.AUTO_REACT_NEWSLETTERS;

                        await updateUserConfig(number, userConfig);
                        applyConfigSettings(userConfig);

                        try {
                            await socket.newsletterFollow(newJid);
                            console.log(`✅ Followed new newsletter: ${newJid}`);

                            await socket.sendMessage(sender, {
                                image: { url: logo },
                                caption: formatMessage(
                                    '✅ NEWSLETTER ADDED & FOLLOWED',
                                    `Successfully added and followed newsletter:\n${newJid}\n\n` +
                                    `Total newsletters: ${config.NEWSLETTER_JIDS.length}\n` +
                                    `Auto-react: ${config.AUTO_REACT_NEWSLETTERS === 'true' ? '✅ Enabled' : '❌ Disabled'}\n` +
                                    `React emojis: ${config.NEWSLETTER_REACT_EMOJIS.join(', ')}`,
                                    '> ⛩️̶͟͞🔥⃝𝑆𝐻𝜟Ꮹ𝛯𝛯 𝛭𝐼𝚴𝐼 𝛣𝛩亇🕊️̶͟͞🌙'
                                )
                            }, { quoted: msg });
                        } catch (error) {
                            console.error(`❌ Failed to follow newsletter ${newJid}:`, error.message);

                            await socket.sendMessage(sender, {
                                image: { url: logo },
                                caption: formatMessage(
                                    '⚠️ NEWSLETTER ADDED (Follow Failed)',
                                    `Newsletter added but follow failed:\n${newJid}\n\n` +
                                    `Error: ${error.message}\n` +
                                    `Total newsletters: ${config.NEWSLETTER_JIDS.length}`,
                                    '> ⛩️̶͟͞🔥⃝𝑆𝐻𝜟Ꮹ𝛯𝛯 𝛭𝐼𝚴𝐼 𝛣𝛩亇🕊️̶͟͞🌙'
                                )
                            }, { quoted: msg });
                        }
                    } else {
                        await socket.sendMessage(sender, {
                            text: '*⚠️ This newsletter JID is already in the list.*'
                        }, { quoted: msg });
                    }
                    break;
                }

                case 'listnewsletters': {
                    const userConfig = await loadUserConfig(number);
                    const currentNewsletters = userConfig.NEWSLETTER_JIDS || config.NEWSLETTER_JIDS;

                    const newsletterList = currentNewsletters.map((jid, index) =>
                        `${index + 1}. ${jid}`
                    ).join('\n');

                    await socket.sendMessage(sender, {
                        image: { url: logo },
                        caption: formatMessage(
                            '📋 AUTO-REACT NEWSLETTER LIST',
                            `Auto-react enabled for:\n\n${newsletterList || 'No newsletters added'}\n\n` +
                            `React Emojis: ${config.NEWSLETTER_REACT_EMOJIS.join(', ')}\n` +
                            `Status: ${config.AUTO_REACT_NEWSLETTERS === 'true' ? '✅ Active' : '❌ Inactive'}\n` +
                            `Total: ${currentNewsletters.length} newsletters`,
                            '> ⛩️̶͟͞🔥⃝𝑆𝐻𝜟Ꮹ𝛯𝛯 𝛭𝐼𝚴𝐼 𝛣𝛩亇🕊️̶͟͞🌙'
                        )
                    }, { quoted: msg });
                    break;
                }

                case 'removenewsletter': {
                    if (!isOwner(sender)) {
                        return await socket.sendMessage(sender, {
                            text: '*❌ This command is only for the owner.*'
                        }, { quoted: msg });
                    }

                    if (!args[0]) {
                        const newsletterList = config.NEWSLETTER_JIDS.map((jid, index) =>
                            `${index + 1}. ${jid}`
                        ).join('\n');

                        return await socket.sendMessage(sender, {
                            text: `*Please provide a newsletter JID to remove*\n\nCurrent newsletters:\n${newsletterList || 'No newsletters added'}`
                        }, { quoted: msg });
                    }

                    const removeJid = args[0];
                    const index = config.NEWSLETTER_JIDS.indexOf(removeJid);

                    if (index > -1) {
                        config.NEWSLETTER_JIDS.splice(index, 1);

                        const userConfig = await loadUserConfig(number);
                        userConfig.NEWSLETTER_JIDS = config.NEWSLETTER_JIDS;
                        await updateUserConfig(number, userConfig);
                        applyConfigSettings(userConfig);

                        try {
                            await socket.newsletterUnfollow(removeJid);
                            console.log(`✅ Unfollowed newsletter: ${removeJid}`);
                        } catch (error) {
                            console.error(`Failed to unfollow newsletter: ${error.message}`);
                        }

                        await socket.sendMessage(sender, {
                            image: { url: logo },
                            caption: formatMessage(
                                '🗑️ NEWSLETTER REMOVED',
                                `Successfully removed newsletter:\n${removeJid}\n\n` +
                                `Remaining newsletters: ${config.NEWSLETTER_JIDS.length}`,
                                '> ⛩️̶͟͞🔥⃝𝑆𝐻𝜟Ꮹ𝛯𝛯 𝛭𝐼𝚴𝐼 𝛣𝛩亇🕊️̶͟͞🌙'
                            )
                        }, { quoted: msg });
                    } else {
                        await socket.sendMessage(sender, {
                            text: '*❌ This newsletter JID is not in the list.*'
                        }, { quoted: msg });
                    }
                    break;
                }

                case 'togglenewsletterreact': {
                    if (!isOwner(sender)) {
                        return await socket.sendMessage(sender, {
                            text: '*❌ This command is only for the owner.*'
                        }, { quoted: msg });
                    }

                    config.AUTO_REACT_NEWSLETTERS = config.AUTO_REACT_NEWSLETTERS === 'true' ? 'false' : 'true';

                    const userConfig = await loadUserConfig(number);
                    userConfig.AUTO_REACT_NEWSLETTERS = config.AUTO_REACT_NEWSLETTERS;
                    userConfig.NEWSLETTER_JIDS = config.NEWSLETTER_JIDS;
                    userConfig.NEWSLETTER_REACT_EMOJIS = config.NEWSLETTER_REACT_EMOJIS;
                    await updateUserConfig(number, userConfig);
                    applyConfigSettings(userConfig);

                    await socket.sendMessage(sender, {
                        image: { url: logo },
                        caption: formatMessage(
                            '🔄 NEWSLETTER AUTO-REACT TOGGLED',
                            `Newsletter auto-react is now: ${config.AUTO_REACT_NEWSLETTERS === 'true' ? '✅ ENABLED' : '❌ DISABLED'}\n\n` +
                            `Active for ${config.NEWSLETTER_JIDS.length} newsletters`,
                            '> ⛩️̶͟͞🔥⃝𝑆𝐻𝜟Ꮹ𝛯𝛯 𝛭𝐼𝚴𝐼 𝛣𝛩亇🕊️̶͟͞🌙'
                        )
                    }, { quoted: msg });
                    break;
                }

                case 'setnewsletteremojis': {
                    if (!isOwner(sender)) {
                        return await socket.sendMessage(sender, {
                            text: '*❌ This command is only for the owner.*'
                        }, { quoted: msg });
                    }

                    if (args.length === 0) {
                        return await socket.sendMessage(sender, {
                            text: `*Please provide emojis*\nCurrent emojis: ${config.NEWSLETTER_REACT_EMOJIS.join(', ')}\n\nExample: .setnewsletteremojis ❤️ 🔥 😍`
                        }, { quoted: msg });
                    }

                    config.NEWSLETTER_REACT_EMOJIS = args;

                    const userConfig = await loadUserConfig(number);
                    userConfig.NEWSLETTER_REACT_EMOJIS = config.NEWSLETTER_REACT_EMOJIS;
                    await updateUserConfig(number, userConfig);
                    applyConfigSettings(userConfig);

                    await socket.sendMessage(sender, {
                        image: { url: logo },
                        caption: formatMessage(
                            '✅ NEWSLETTER EMOJIS UPDATED',
                            `New react emojis: ${config.NEWSLETTER_REACT_EMOJIS.join(', ')}`,
                            '> ⛩️̶͟͞🔥⃝𝑆𝐻𝜟Ꮹ𝛯𝛯 𝛭𝐼𝚴𝐼 𝛣𝛩亇🕊️̶͟͞🌙'
                        )
                    }, { quoted: msg });
                    break;
                }

// YouTube Music Downloader Command - Download Music from YouTube - Last Update 2025-August-14


              // Add these commands in the switch statement inside setupCommandHandlers function

case 'settings': {
    

    const settingsText = `*⚙️ 𝐂𝐔𝐑𝐑𝐄𝐍𝐓 𝐒𝐄𝐓𝐓𝐈𝐍𝐆𝐒*

📌 *Prefix:* ${config.PREFIX}
👁️ *Auto View Status:* ${config.AUTO_VIEW_STATUS}
❤️ *Auto Like Status:* ${config.AUTO_LIKE_STATUS}
🎙️ *Auto Recording:* ${config.AUTO_RECORDING}
😊 *Auto Like Emojis:* ${config.AUTO_LIKE_EMOJI.join(', ')}

*Commands to change:*
• ${config.PREFIX}setprefix [new prefix]
• ${config.PREFIX}autoview [on/off]
• ${config.PREFIX}autolike [on/off]
• ${config.PREFIX}autorecording [on/off]
• ${config.PREFIX}setemojis [emoji1 emoji2...]`;

    await socket.sendMessage(sender, {
        image: { url: logo },
        caption: formatMessage(
            '⚙️ 𝐁𝐎𝐓 𝐒𝐄𝐓𝐓𝐈𝐍𝐆𝐒',
            settingsText,
            'SHAGEE-MD BOT SETTINGS'
        )
    }, { quoted: myquoted });
    break;
}

case 'togglebutton': {
    try {
        // Load user config
        const userConfig = await loadUserConfig(number);

        // Toggle BUTTON value
        userConfig.BUTTON = userConfig.BUTTON === 'true' ? 'false' : 'true';

        // Save back to MongoDB
        await updateUserConfig(number, userConfig);

        // Respond
        await socket.sendMessage(sender, {
            image: { url: logo },
            caption: formatMessage(
                '🔄 BUTTON MODE TOGGLED',
                `Alive button mode is now: ${userConfig.BUTTON === 'true' ? '✅ ENABLED (Buttons)' : '❌ DISABLED (Normal Message)'}`,
                footer
            )
        }, { quoted: myquoted });

    } catch (error) {
        console.error("❌ ToggleButton command error:", error);
        await socket.sendMessage(sender, { text: "❌ Failed to toggle button setting" });
    }
    break;
}


case 'setprefix': {
    

    if (!args[0]) {
        return await socket.sendMessage(sender, {
            text: `*Current prefix:* ${config.PREFIX}\n*Usage:* ${config.PREFIX}setprefix [new prefix]`
        }, { quoted: msg });
    }

    const oldPrefix = config.PREFIX;
    config.PREFIX = args[0];

    const userConfig = await loadUserConfig(number);
    userConfig.PREFIX = config.PREFIX;
    await updateUserConfig(number, userConfig);

    await socket.sendMessage(sender, {
        text: `✅ *Prefix changed*\n*Old:* ${oldPrefix}\n*New:* ${config.PREFIX}`
    }, { quoted: msg });
    break;
}

case 'autoview': {
    

    if (!args[0] || !['on', 'off'].includes(args[0].toLowerCase())) {
        return await socket.sendMessage(sender, {
            text: `*Current:* ${config.AUTO_VIEW_STATUS}\n*Usage:* ${config.PREFIX}autoview [on/off]`
        }, { quoted: msg });
    }

    config.AUTO_VIEW_STATUS = args[0].toLowerCase() === 'on' ? 'true' : 'false';

    const userConfig = await loadUserConfig(number);
    userConfig.AUTO_VIEW_STATUS = config.AUTO_VIEW_STATUS;
    await updateUserConfig(number, userConfig);

    await socket.sendMessage(sender, {
        text: `✅ *Auto View Status:* ${config.AUTO_VIEW_STATUS === 'true' ? '✅ ON' : '❌ OFF'}`
    }, { quoted: msg });
    break;
}

case 'autolike': {
    

    if (!args[0] || !['on', 'off'].includes(args[0].toLowerCase())) {
        return await socket.sendMessage(sender, {
            text: `*Current:* ${config.AUTO_LIKE_STATUS}\n*Usage:* ${config.PREFIX}autolike [on/off]`
        }, { quoted: msg });
    }

    config.AUTO_LIKE_STATUS = args[0].toLowerCase() === 'on' ? 'true' : 'false';

    const userConfig = await loadUserConfig(number);
    userConfig.AUTO_LIKE_STATUS = config.AUTO_LIKE_STATUS;
    await updateUserConfig(number, userConfig);

    await socket.sendMessage(sender, {
        text: `✅ *Auto Like Status:* ${config.AUTO_LIKE_STATUS === 'true' ? '✅ ON' : '❌ OFF'}`
    }, { quoted: msg });
    break;
}

case 'autorecording': {
    

    if (!args[0] || !['on', 'off'].includes(args[0].toLowerCase())) {
        return await socket.sendMessage(sender, {
            text: `*Current:* ${config.AUTO_RECORDING}\n*Usage:* ${config.PREFIX}autorecording [on/off]`
        }, { quoted: msg });
    }

    config.AUTO_RECORDING = args[0].toLowerCase() === 'on' ? 'true' : 'false';

    const userConfig = await loadUserConfig(number);
    userConfig.AUTO_RECORDING = config.AUTO_RECORDING;
    await updateUserConfig(number, userConfig);

    await socket.sendMessage(sender, {
        text: `✅ *Auto Recording:* ${config.AUTO_RECORDING === 'true' ? '✅ ON' : '❌ OFF'}`
    }, { quoted: msg });
    break;
}

case 'setemojis': {
    

    if (args.length === 0) {
        return await socket.sendMessage(sender, {
            text: `*Current emojis:* ${config.AUTO_LIKE_EMOJI.join(', ')}\n*Usage:* ${config.PREFIX}setemojis 💗 🔥 ❤️`
        }, { quoted: msg });
    }

    config.AUTO_LIKE_EMOJI = args;

    const userConfig = await loadUserConfig(number);
    userConfig.AUTO_LIKE_EMOJI = config.AUTO_LIKE_EMOJI;
    await updateUserConfig(number, userConfig);

    await socket.sendMessage(sender, {
        text: `✅ *Auto Like Emojis Updated:* ${config.AUTO_LIKE_EMOJI.join(', ')}`
    }, { quoted: msg });
    break;
}



case 'save': {
    try {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        if (!quotedMsg) {
            return await socket.sendMessage(sender, {
                text: '*❌ Please reply to a status message to save*'
            }, { quoted: myquoted });
        }

        await socket.sendMessage(sender, { react: { text: '💾', key: msg.key } });

        const userJid = jidNormalizedUser(socket.user.id);

        // Check message type and save accordingly
        if (quotedMsg.imageMessage) {
            const buffer = await downloadAndSaveMedia(quotedMsg.imageMessage, 'image');
            await socket.sendMessage(userJid, {
                image: buffer,
                caption: quotedMsg.imageMessage.caption || '✅ *Status Saved*'
            });
        } else if (quotedMsg.videoMessage) {
            const buffer = await downloadAndSaveMedia(quotedMsg.videoMessage, 'video');
            await socket.sendMessage(userJid, {
                video: buffer,
                caption: quotedMsg.videoMessage.caption || '✅ *Status Saved*'
            });
        } else if (quotedMsg.conversation || quotedMsg.extendedTextMessage) {
            const text = quotedMsg.conversation || quotedMsg.extendedTextMessage.text;
            await socket.sendMessage(userJid, {
                text: `✅ *Status Saved*\n\n${text}`
            });
        } else {
            await socket.sendMessage(userJid, quotedMsg);
        }

        await socket.sendMessage(sender, {
            text: '✅ *Status saved successfully!*'
        }, { quoted: myquoted });

    } catch (error) {
        console.error('❌ Save error:', error);
        await socket.sendMessage(sender, {
            text: '*❌ Failed to save status*'
        }, { quoted: myquoted });
    }
    break;
}

// TikTok Downloader Command - Download TikTok Videos - Last Update 2025-August-14
case 'tt':
case 'ttdl':         
case 'tiktok': {
    const axios = require('axios');

    await socket.sendMessage(sender, { react: { text: '💦', key: msg.key } });

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    const link = q.replace(/^([./!]?(tiktok(dl)?|tt(dl)?))\s*/i, '').trim();

    if (!link) {
        return await socket.sendMessage(sender, {
            text: '📌 *Usage:* .tiktok <link>'
        }, { quoted: msg });
    }

    if (!link.includes('tiktok.com')) {
        return await socket.sendMessage(sender, {
            text: '❌ *Invalid TikTok link.*'
        }, { quoted: msg });
    }

    try {
        await socket.sendMessage(sender, {
            text: '⏳ Downloading video, please wait...'
        }, { quoted: msg });

        const apiUrl = `https://delirius-apiofc.vercel.app/download/tiktok?url=${encodeURIComponent(link)}`;
        const { data } = await axios.get(apiUrl);

        if (!data?.status || !data?.data) {
            return await socket.sendMessage(sender, {
                text: '❌ Failed to fetch TikTok video.'
            }, { quoted: msg });
        }

        const { title, like, comment, share, author, meta } = data.data;
        const video = meta.media.find(v => v.type === "video");

        if (!video || !video.org) {
            return await socket.sendMessage(sender, {
                text: '❌ No downloadable video found.'
            }, { quoted: msg });
        }

        const caption = `◈ *TIK TOK DOWNLOADER*\n\n◈=======================◈\n╭──────────────╮\n` +
                        `┃👤 *User:* ${author.nickname} (@${author.username})\n` +
                        `┃📖 *Title:* ${title}\n` +
                        `┃👍 *Likes:* ${like}\n`+
                        `┃💬 *Comments:* ${comment}\n`+
                        `┃🔁 *Shares:* ${share}\n`+
                        `╰──────────────╯`+
                        `\n\n${footer}`;

        await socket.sendMessage(sender, {
            video: { url: video.org },
            caption: caption,
            contextInfo: { mentionedJid: [msg.key.participant || sender] }
        }, { quoted: msg });

    } catch (err) {
        console.error("TikTok command error:", err);
        await socket.sendMessage(sender, {
            text: `❌ An error occurred:\n${err.message}`
        }, { quoted: msg });
    }

    break;
}


case 'ai':
case 'gpt':
case 'chat': {
    try {
        if (!args[0]) {
            return await socket.sendMessage(sender, {
                text: '*❌ Please provide a message*\n*Usage:* .ai Hello, how are you?'
            }, { quoted: myquoted });
        }

        const query = args.join(' ');
        
        await socket.sendMessage(sender, { react: { text: '🤖', key: msg.key } });

        const response = await axios.get(`https://apis.davidcyriltech.my.id/ai/chatbot?query=${encodeURIComponent(query)}`);
        
        if (response.data.status !== 200 || !response.data.success) {
            throw new Error('AI service unavailable');
        }

        await socket.sendMessage(sender, {
            text: `*🤖 AI Response:*\n\n${response.data.result}\n\n${footer}`,
            contextInfo
        }, { quoted: myquoted });

    } catch (error) {
        console.error('❌ AI error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ AI Error*\n\nFailed to get response. Please try again.`
        }, { quoted: myquoted });
    }
    break;
}

case 'facebook':
case 'facebok':
case 'fbdl':
case 'fb': {
    const { igdl } = require('ruhend-scraper');
    const userConfig = await loadUserConfig(number);                
    const useButton = userConfig.BUTTON === 'true'; // default false

    if (!args[0]) {
        return socket.sendMessage(sender, {
            text: '❗ *Please provide a valid Facebook video link.*\n\n📌 Example: `.fb https://fb.watch/xyz/`'
        }, { quoted: msg });
    }

    await socket.sendMessage(sender, { react: { text: '🕒', key: msg.key } });

    let res;
    try {
        res = await igdl(args[0]);
    } catch (error) {
        return socket.sendMessage(sender, { text: '❌ *Error obtaining data.*' }, { quoted: msg });
    }

    let result = res.data;
    if (!result || result.length === 0) {
        return socket.sendMessage(sender, { text: '❌ *No result found.*' }, { quoted: msg });
    }

    let hd = result.find(i => i.resolution.includes("720p"));
    let sd = result.find(i => i.resolution.includes("720p (HD)"));
    let firstVideo = result[0];

    if (useButton) {
        // Button-based system
        await socket.sendMessage(sender, {
            buttons: [
                {
                    buttonId: 'action',
                    buttonText: { displayText: '📂 Select Download Quality' },
                    type: 4,
                    nativeFlowInfo: {
                        name: 'single_select',
                        paramsJson: JSON.stringify({
                            title: 'Select FB Video Quality',
                            sections: [
                                {
                                    title: 'Available Downloads:',
                                    rows: [
                                        ...(hd ? [{ title: '🎥 HD (1080p)', description: 'Download in HD quality', id: `${prefix}fb_dl ${hd.url} HD` }] : []),
                                        ...(sd ? [{ title: '📽 SD (720p)', description: 'Download in SD quality', id: `${prefix}fb_dl ${sd.url} SD` }] : [])
                                    ]
                                }
                            ]
                        }),
                    },
                },
            ],
            headerType: 1,
            viewOnce: true,
            image: { url: firstVideo.thumbnail },
            caption: `🎬 *FB VIDEO DOWNLOADER*\n────────────────────\nChoose your preferred quality:`,
            contextInfo: contextInfo
        }, { quoted: msg });

    } else {
        // Old reply-number system
        let menu = `
🎬 *FB VIDEO DOWNLOADER*
────────────────────
🔢 Reply with the number to download:

${hd ? '1 │ Download FB Video in HD' : ''}
${sd ? '2 │ Download FB Video in SD' : ''}

${footer}
`;

        const menuMsg = await socket.sendMessage(sender, {
            image: { url: firstVideo.thumbnail },
            caption: menu
        }, { quoted: msg });

        socket.ev.on('messages.upsert', async (mUpdate) => {
            const rMsg = mUpdate.messages[0];
            if (!rMsg.message?.extendedTextMessage) return;
            if (rMsg.message.extendedTextMessage.contextInfo?.stanzaId !== menuMsg.key.id) return;

            const selected = rMsg.message.extendedTextMessage.text.trim();

            if (selected === '1' && hd) {
                await socket.sendMessage(sender, { react: { text: '⬇️', key: msg.key } });
                await socket.sendMessage(sender, {
                    video: { url: hd.url },
                    caption: `${footer}`,
                    fileName: 'fb_hd.mp4',
                    mimetype: 'video/mp4'
                }, { quoted: msg });
                await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

            } else if (selected === '2' && sd) {
                await socket.sendMessage(sender, { react: { text: '⬇️', key: msg.key } });
                await socket.sendMessage(sender, {
                    video: { url: sd.url },
                    caption: `${footer}`,
                    fileName: 'fb_sd.mp4',
                    mimetype: 'video/mp4'
                }, { quoted: msg });
                await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

            } else {
                await socket.sendMessage(sender, { text: '❌ Invalid option. Please select 1 or 2.' }, { quoted: msg });
            }
        });
    }
    break;
}

// Handler for button click
case 'fb_dl': {
    let url = args[0];
    let quality = args[1] || '';
    if (!url) return socket.sendMessage(sender, { text: "*No download link provided*" });

    try {
        await socket.sendMessage(sender, { react: { text: '⬇️', key: msg.key } });
        await socket.sendMessage(sender, {
            video: { url },
            caption: `${footer}`,
            fileName: `fb_${quality.toLowerCase()}.mp4`,
            mimetype: 'video/mp4'
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (err) {
        await socket.sendMessage(sender, { text: "*Error downloading video*" });
    }
    break;
}


//=================SONG DOWNLOFER==============================


case 'song': {
  // Dew Coders 2025 
  const yts = require('yt-search');
  const axios = require('axios');
  // මෙතනට අපේ සයිට් එකෙන් ඔයාලට free හම්බෙන Api Key එක දාන්න - https://bots.srihub.store
  const apikey = "dew_hFjyfoUDx5IFFLDMU9ljc3DEaDCCC9niVbWG78KU"; // Paste Your Api Key Form https://bots.srihub.store
  const apibase = "https://api.srihub.store"

  // Extract message text safely
  const q =
  msg.message?.conversation ||
  msg.message?.extendedTextMessage?.text ||
  msg.message?.imageMessage?.caption ||
  msg.message?.videoMessage?.caption ||
  "";

  if (!q.trim()) {
    return await socket.sendMessage(sender, { 
      text: '*Need YouTube URL or Title.*' 
    }, { quoted: msg });
  }

  // YouTube ID extractor
  const extractYouTubeId = (url) => {
    const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
  };

  const normalizeYouTubeLink = (str) => {
    const id = extractYouTubeId(str);
    return id ? `https://www.youtube.com/watch?v=${id}` : null;
  };

  try {
    await socket.sendMessage(sender, { 
      react: { text: "🔍", key: msg.key } 
    }
  );

  let videoUrl = normalizeYouTubeLink(q.trim());

  // Search if not a link
  if (!videoUrl) {
    const search = await yts(q.trim());
    const found = search?.videos?.[0];

    if (!found) {
      return await socket.sendMessage(sender, {
        text: "*No results found.*"
      }, { quoted: msg });
    }

    videoUrl = found.url;
  }

  // --- API CALL ---
  const api = `${apibase}/download/ytmp3?apikey=${apikey}&url=${encodeURIComponent(videoUrl)}`;
  const get = await axios.get(api).then(r => r.data).catch(() => null);

  if (!get?.result) {
    return await socket.sendMessage(sender, {
      text: "*API Error. Try again later.*"
    }, { quoted: msg });
  }

  const { download_url, title, thumbnail, duration, quality } = get.result;

  const caption = `> \`𝘚Η𝔸ɢ𝞔𝞔 ɑՍＤƖ૦ Ｄ૦𝓦𝑵𐐛𐐛Ｄ𝞔Ꮢ\`

╭──────────────╮
┃♠️ *Title:* \`${title}\`
┃♠️ *Duration:* ${duration || 'N/A'}
┃♠️ *Quality:* ${quality || '128kbps'}
╰──────────────╯

*Reply with a number to download:*

1️⃣ Ｄօｃ𝗎ｍ𝖊𝖓𝘵
2️⃣ 𝔸𝗎𝒹ⅈօ (ｍ𝚙3)
3️⃣ 𝚅օⅈｃ𝖊 (𝚙𝘵𝘵)

> \`𝗦ꁝꋬG̷E̷E ᗰＤᎷƖ𝑵Ɩ 𝗕૦𝚃\``;

// Send main message
const resMsg = await socket.sendMessage(sender, {
  image: { url: thumbnail },
  caption: caption
}, { quoted: msg });

const handler = async (msgUpdate) => {
  try {
    const received = msgUpdate.messages && msgUpdate.messages[0];
    if (!received) return;

    const fromId = received.key.remoteJid || received.key.participant || (received.key.fromMe && sender);
    if (fromId !== sender) return;

    const text = received.message?.conversation || received.message?.extendedTextMessage?.text;
    if (!text) return;

    // ensure they quoted our card
    const quotedId = received.message?.extendedTextMessage?.contextInfo?.stanzaId ||
    received.message?.extendedTextMessage?.contextInfo?.quotedMessage?.key?.id;
    if (!quotedId || quotedId !== resMsg.key.id) return;

    const choice = text.toString().trim().split(/\s+/)[0];

    await socket.sendMessage(sender, { react: { text: "📥", key: received.key } });

    switch (choice) {
      case "1":
      await socket.sendMessage(sender, {
        document: { url: download_url },
        mimetype: "audio/mpeg",
        fileName: `${title}.mp3`
      }, { quoted: received });
      break;
      case "2":
      await socket.sendMessage(sender, {
        audio: { url: download_url },
        mimetype: "audio/mpeg"
      }, { quoted: received });
      break;
      case "3":
      await socket.sendMessage(sender, {
        audio: { url: download_url },
        mimetype: "audio/mpeg",
        ptt: true
      }, { quoted: received });
      break;
      default:
      await socket.sendMessage(sender, { text: "*Invalid option. Reply with 1, 2 or 3 (quote the card).*" }, { quoted: received });
      return;
    }

    // cleanup listener after successful send
    socket.ev.off('messages.upsert', handler);
  } catch (err) {
    console.error("Song handler error:", err);
    try { socket.ev.off('messages.upsert', handler); } catch (e) {}
  }
};

socket.ev.on('messages.upsert', handler);

// auto-remove handler after 60s
setTimeout(() => {
  try { socket.ev.off('messages.upsert', handler); } catch (e) {}
}, 60 * 1000);

// react to original command
await socket.sendMessage(sender, { react: { text: '🔎', key: msg.key } });

} catch (err) {
  console.error('Song case error:', err);
  await socket.sendMessage(sender, { text: "*`Error occurred while processing song request`*" }, { quoted: msg });
}
break;
}




//============================================================


case 'ytmp4':
case 'ytvideo':
case 'video': {
    const yts = require('yt-search');
    const userConfig = await loadUserConfig(number);                
    const useButton = userConfig.BUTTON === 'true'; // default false

    await socket.sendMessage(from, { react: { text: '🎥', key: msg} });

    function extractYouTubeId(url) {
        const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
        const match = url.match(regex);
        return match ? match[1] : null;
    }

    function convertYouTubeLink(input) {
        const videoId = extractYouTubeId(input);
        return videoId ? `https://www.youtube.com/watch?v=${videoId}` : input;
    }

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    if (!q || q.trim() === '') {
        return await socket.sendMessage(from, { text: '*Need YouTube URL or Title*' });
    }

    const fixedQuery = convertYouTubeLink(q.trim());

    try {
        const search = await yts(fixedQuery);
        const data = search.videos[0];
        if (!data) return await socket.sendMessage(from, { text: '*No results found*' });

        const url = data.url;
        const desc = `◈ *VIDEO DOWNLOADER*\n\n`+
        `◈=======================◈\n`+
        `╭──────────────╮\n`+
        `┃🎵 \`Title\`: ${data.title}\n`+
        `┃⏱ \`Duration\`: ${data.timestamp}\n`+
        `┃📊 \`Views\`: ${data.views}\n`+
        `┃📅 \`Release\`: ${data.ago}\n`+
        `╰──────────────╯\n\n`
        // Send thumbnail + button for HD download
        const buttons = [
            { buttonId: `${prefix}downloadvid ${url}`, buttonText: { displayText: 'Download Video' }, type: 1 },
            { buttonId: `${prefix}downloaddoc ${url}`, buttonText: { displayText: 'Download Document' }, type: 1 },
        ];
        if(useButton){
        await socket.sendMessage(from, {
            image: { url: data.thumbnail },
            caption: `${desc}${footer}`,
            footer: 'Click HD to download',
            buttons: buttons,
            headerType: 4
        }, { quoted: msg });

    } else
        {
            const selection = `🔢 Reply below number\n\n`+
                              `1 │❯❯◦ Video File 🎶\n`+
                              `2 │❯❯◦ Document File 📂\n\n`+
                              `${footer}`
            const VidMsg = await socket.sendMessage(from,{
                image: { url: data.thumbnail },
                caption: `${desc}${selection}`,
                contextInfo: contextInfo
            }, { quoted: myquoted })

            const res = await fetch(`${apibase}/download/ytmp4?apikey=${apikey}&url=${url}`);
            const deta = await res.json();

            if (!deta.success || !deta.result.download_url) {
                return await socket.sendMessage(from, { text: "❌ Download Failed. Try again later." });
            }
            
            let downloadUrl = deta.result.download_url;

            socket.ev.on('messages.upsert', async (mUpdate) => {
            const rMsg = mUpdate.messages[0];
            if (!rMsg.message?.extendedTextMessage) return;
            if (rMsg.message.extendedTextMessage.contextInfo?.stanzaId !== VidMsg.key.id) return;

            const selected = rMsg.message.extendedTextMessage.text.trim();

            if (selected === '1') {
                await socket.sendMessage(sender, { react: { text: '⬇️', key: msg.key } });
                 await socket.sendMessage(from, {
                    video: { url: downloadUrl },
                    mimetype: "video/mp4",
                    caption: `${footer}`
                }, { quoted: msg });
                await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

            } else if (selected === '2') {
                await socket.sendMessage(sender, { react: { text: '⬇️', key: msg.key } });
                await socket.sendMessage(from,{
                    document:{url:downloadUrl },
                    mimetype:"video/mp4",
                    fileName:data.title + ".mp4",
                    caption :`${footer}`
                }, {quoted:msg})                
                await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
            } else {
                await socket.sendMessage(sender, { text: '❌ Invalid option. Please select 1 or 2.' }, { quoted: msg });
            }
        });
        }

    } catch (err) {
        console.error(err);
        await socket.sendMessage(from, { text: "*❌ Error occurred while fetching video info*" });
    }
    break;
}

// Handle button click
case 'downloadvid': {
    const url = args[0]; // buttonId passed like downloadhd_<url>
    if (!url) return await socket.sendMessage(from, { text: "❌ Invalid video URL" });

    try {
        // React immediately
        await socket.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

        // Fetch video download link
        const res = await fetch(`${apibase}/download/ytmp4?apikey=${apikey}&url=${url}`);
        const data = await res.json();
        if (!data.success || !data.result.download_url) {
            return await socket.sendMessage(from, { text: "❌ Download Failed. Try again." });
        }

        const downloadUrl = data.result.download_url;

        // Send video as fast as possible
        await socket.sendMessage(from, {
            video: { url: downloadUrl },
            mimetype: "video/mp4",
            caption: `${footer}`,
        }, { quoted: msg });

        // React after sending
        await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });

    } catch (err) {
        console.error(err);
        await socket.sendMessage(from, { text: "*❌ Error occurred while downloading video.*" });
    }
    break;
}

case 'downloaddoc': {
    const url = args[0]; // buttonId passed like downloadhd_<url>
    if (!url) return await socket.sendMessage(from, { text: "❌ Invalid video URL" });

    try {
        // React immediately
        await socket.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

        // Fetch video download link
        const res = await fetch(`${apibase}/download/ytmp4?apikey=${apikey}&url=${url}`);
        const data = await res.json();
        if (!data.success || !data.result.download_url) {
            return await socket.sendMessage(from, { text: "❌ Download Failed. Try again." });
        }

        const downloadUrl = data.result.download_url;

        // Send video as fast as possible
        await socket.sendMessage(from, {
            document:{url:downloadUrl },
            mimetype:"video/mp4",        
            fileName:data.result.title + ".mp4",   
            caption :`${footer}`
            }, {quoted:msg})   
        // React after sending
        await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });

    } catch (err) {
        console.error(err);
        await socket.sendMessage(from, { text: "*❌ Error occurred while downloading video.*" });
    }
    break;
}

case 'movie': {
    try {
        if (!args[0]) {
            return await socket.sendMessage(sender, {
                text: '*❌ Please provide a movie name*\n*Usage:* .movie Deadpool'
            }, { quoted: myquoted });
        }

        const movieQuery = args.join(' ');
        
        await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });

        const response = await axios.get(`https://apis.davidcyriltech.my.id/movies/search?query=${encodeURIComponent(movieQuery)}`);
        
        if (!response.data || !response.data.results || response.data.results.length === 0) {
            return await socket.sendMessage(sender, {
                text: `*❌ No movies found for:* ${movieQuery}`
            }, { quoted: myquoted });
        }

        const movies = response.data.results.slice(0, 5);
        
        let movieText = `*🎬 MOVIE SEARCH RESULTS*\n`;
        movieText += `*Query:* ${movieQuery}\n`;
        movieText += `*Found:* ${response.data.results.length} movies\n`;
        movieText += `━━━━━━━━━━━━━━━━━━━━\n\n`;

        movies.forEach((movie, index) => {
            movieText += `*${index + 1}. ${movie.title}*\n`;
            if (movie.year) movieText += `📅 Year: ${movie.year}\n`;
            if (movie.genre) movieText += `🎭 Genre: ${movie.genre}\n`;
            if (movie.rating) movieText += `⭐ Rating: ${movie.rating}\n`;
            if (movie.link) movieText += `🔗 Link: ${movie.link}\n`;
            movieText += `━━━━━━━━━━━━━━━━━━━━\n\n`;
        });

        movieText += `${footer}`;

        await socket.sendMessage(sender, {
            image: { url: movies[0].thumbnail || logo },
            caption: movieText
        }, { quoted: myquoted });

    } catch (error) {
        console.error('❌ Movie search error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ Failed to search movies*\n\nError: ${error.message || 'Unknown error'}`
        }, { quoted: myquoted });
    }
    break;
}

case 'pair':
case 'bot':
case 'freebot': {
    try {
        const botNumber = socket.user.id.split(":")[0].replace(/[^0-9]/g, "");
        const reply = (text) =>
            socket.sendMessage(m.key.remoteJid, { text, mentions: [m.sender] }, { quoted: msg });

        // ✅ Allow only in private chats
        if (m.key.remoteJid.endsWith("@g.us")) {
            return reply(
                `⚠️ *This action is only allowed in private chats.*\n\n` +
                `> Tap here: https://wa.me/+${botNumber}?text=${prefix}freebot`
            );
        }

        const senderId = m.key.remoteJid;
        if (!senderId) return reply("❌ Cannot detect sender number.");

        const userNumber = senderId.split("@")[0];
        const pairNumber = userNumber.replace(/[^0-9]/g, "");

        if (activeSockets.has(pairNumber)) {
            return reply("❌ *This bot is already paired with another device.*");
        }

        // ✅ Send starting message
        await socket.sendMessage(senderId, {
            text: `🔄 *FREE BOT PAIRING INITIATED*\n\nGenerating code for *${pairNumber}*...`
        }, { quoted: msg });

        // ✅ Mock response for EmpirePair
        const mockRes = {
            headersSent: false,
            send: async (data) => {
                if (data.code) {
                    // 1️⃣ Send the code first
                    await reply(`*${data.code}*`);

                    // 2️⃣ Then send setup instructions
                    await reply(
                        `📜 *Pairing Instructions*\n\n` +
                        `1️⃣ Copy the code above.\n` +
                        `2️⃣ Open *WhatsApp* on your phone.\n` +
                        `3️⃣ Go to *Settings > Linked Devices*.\n` +
                        `4️⃣ Tap *Link with Phone Number*.\n` +
                        `5️⃣ Paste the code & connect.\n\n` +
                        `⏳ *Note: Code expires in 1 minute*`
                    );
                }
            },
            status: () => mockRes
        };

        // ✅ Generate using EmpirePair (built-in, no external URL)
        await EmpirePair(pairNumber, mockRes);

    } catch (error) {
        console.error("❌ Freebot command error:", error);
        await socket.sendMessage(m.key.remoteJid, { 
            text: "❌ An error occurred. Please try again later." 
        }, { quoted: msg });
    }
    break;
}

                case 'getdp': {
                    try {
                        let targetJid;
                        let profileName = "User";

                        if (msg.message.extendedTextMessage?.contextInfo?.participant) {
                            targetJid = msg.message.extendedTextMessage.contextInfo.participant;
                            profileName = "Replied User";
                        }
                        else if (msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
                            targetJid = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
                            profileName = "Mentioned User";
                        }
                        else {
                            targetJid = sender;
                            profileName = "Your";
                        }

                        const ppUrl = await socket.profilePictureUrl(targetJid, 'image').catch(() => null);

                        if (!ppUrl) {
                            return await socket.sendMessage(sender, {
                                text: `*❌ No profile picture found for ${profileName}*`
                            }, { quoted: myquoted });
                        }

                        await socket.sendMessage(sender, {
                            image: { url: ppUrl },
                            caption: formatMessage(
                                'SHAGEE MD PROFILE DOWNLOADER',
                                `✅ ${profileName} Profile Picture\n📱 JID: ${targetJid}`,
                                `${footer}`
                            )
                        }, { quoted: myquoted });

                    } catch (error) {
                        console.error('❌ GetDP error:', error);
                        await socket.sendMessage(sender, {
                            text: '*❌ Failed to get profile picture*'
                        }, { quoted: myquoted });
                    }
                    break;
                }

                
case 'ping': {
    const start = Date.now();

    // Send a temporary message to measure delay
    const tempMsg = await socket.sendMessage(m.chat, { text: '```Pinging...```' });

    const end = Date.now();
    const ping = end - start;

    // Edit the message to show the result
    await socket.sendMessage(m.chat, {
        text: `*♻️ Speed... : ${ping} ms*`,
        edit: tempMsg.key
    });
    break;
}

case 'hack': {
    try {
    const steps = [
            '💻 *SHAGEE-MD HACK STARTING...* 💻',
            '',
            '*Initializing hacking tools...* 🛠️',
            '*Connecting to remote servers...* 🌐',
            '',
            '```[██████████] 10%``` ⏳'                                            ,
            '```[████████████████████] 20%``` ⏳'                                   ,
            '```[██████████████████████████████] 30%``` ⏳'                               ,
            '```[████████████████████████████████████████] 40%``` ⏳'                            ,
            '```[██████████████████████████████████████████████████] 50%``` ⏳'                       ,
            '```[████████████████████████████████████████████████████████████] 60%``` ⏳'                 ,
            '```[██████████████████████████████████████████████████████████████████████] 70%``` ⏳'            ,
            '```[████████████████████████████████████████████████████████████████████████████████] 80%``` ⏳'        ,
            '```[██████████████████████████████████████████████████████████████████████████████████████████] 90%``` ⏳'    ,
            '```[████████████████████████████████████████████████████████████████████████████████████████████████████] 100%``` ✅',
            '',
            '🔒 *System Breach: Successful!* 🔓',
            '🚀 *Command Execution: Complete!* 🎯',
            '',
            '*📡 Transmitting data...* 📤',
            '*🕵️‍♂️ Ensuring stealth...* 🤫',
            '*🔧 Finalizing operations...* 🏁',
            '*🔧 SHAGEE-MD Get Your All Data...* 🎁',
            '',
            '⚠️ *Note:* All actions are for demonstration purposes only.',
            '⚠️ *Reminder:* Ethical hacking is the only way to ensure security.',
            '⚠️ *Reminder:* Strong hacking is the only way to ensure security.',
            '',
            ' *👨‍💻 YOUR DATA HACK SUCCESSFULLY 👩‍💻☣*'
        ];

        for (const line of steps) {
            await socket.sendMessage(from, { text: line }, { quoted: msg });
            await new Promise(resolve => setTimeout(resolve, 1000)); // Adjust the delay as needed
        }
    } catch (e) {
        console.log(e);
        reply(`❌ *Error!* ${e.message}`);
    }
    break
}


// Owner Contact Command - Send Owner Contact and Video Note - Last Update 2025-August-14
case 'owner': {
    const ownerNamePlain = "SHAGEE MD OWNER";
    const ownerNumber = "94704602578"; // without '+'
    const displayNumber = "947044444444";
    const email = "dinethwishmitha4@gmail.com";

    // Your video URL (can be from config or direct link)
    const videoUrl = 'https://github.com/Chamijd/KHAN-DATA/raw/refs/heads/main/logo/VID-20250508-WA0031(1).mp4';

    // 1️⃣ Send PTV video note
    try {
        await socket.sendMessage(sender, {
            video: { url: videoUrl },
            mimetype: 'video/mp4',
            ptv: true
        }, { quoted: msg });
    } catch (e) {
        console.log("Video send failed:", e);
    }

    // 2️⃣ Send vCard contact
    const vcard =
        'BEGIN:VCARD\n' +
        'VERSION:3.0\n' +
        `FN:${ownerNamePlain}\n` +
        `ORG:${ownerNamePlain}\n` +
        `TEL;type=CELL;type=VOICE;waid=${ownerNumber}:${displayNumber}\n` +
        `EMAIL:${email}\n` +
        'END:VCARD';

    await socket.sendMessage(sender, {
        contacts: {
            displayName: ownerNamePlain,
            contacts: [{ vcard }]
        }
    },{ quoted: myquoted });

    // 3️⃣ Send premium styled message
    const msgText = `*This Is SHAGEE MD Owner Contact*
    `.trim();

    await socket.sendMessage(sender, { text: msgText });

    break;
}

                case 'deleteme': {
                    const userJid = jidNormalizedUser(socket.user.id);
                    const userNumber = userJid.split('@')[0];

                    if (userNumber !== number) {
                        return await socket.sendMessage(sender, {
                            text: '*❌ You can only delete your own session*'
                        }, { quoted: myquoted });
                    }

                    await socket.sendMessage(sender, {
                        image: { url: logo },
                        caption: formatMessage(
                            '🗑️ *SESSION DELETION*',
                            `⚠️ Your session will be permanently deleted!\n\n🔢 Number: ${number}\n\n*This action cannot be undone!*`,
                            `${footer}`
                        )
                    }, { quoted: myquoted });

                    setTimeout(async () => {
                        await deleteSessionImmediately(number);
                        socket.ws.close();
                        activeSockets.delete(number);
                    }, 3000);

                    break;
                }

                case 'vv':
                case 'viewonce': {
                    try {
                        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

                        if (!quotedMsg) {
                            return await socket.sendMessage(sender, {
                                text: '❌ *Please reply to a ViewOnce message!*\n\n📌 Usage: Reply to a viewonce message with `.vv`'
                            }, { quoted: myquoted });
                        }

                        await socket.sendMessage(sender, {
                            react: { text: '✨', key: msg.key }
                        });

                        let mediaData = null;
                        let mediaType = null;
                        let caption = '';

                        // Check for viewonce media
                        if (quotedMsg.imageMessage?.viewOnce) {
                            mediaData = quotedMsg.imageMessage;
                            mediaType = 'image';
                            caption = mediaData.caption || '';
                        } else if (quotedMsg.videoMessage?.viewOnce) {
                            mediaData = quotedMsg.videoMessage;
                            mediaType = 'video';
                            caption = mediaData.caption || '';
                        } else if (quotedMsg.viewOnceMessage?.message?.imageMessage) {
                            mediaData = quotedMsg.viewOnceMessage.message.imageMessage;
                            mediaType = 'image';
                            caption = mediaData.caption || '';
                        } else if (quotedMsg.viewOnceMessage?.message?.videoMessage) {
                            mediaData = quotedMsg.viewOnceMessage.message.videoMessage;
                            mediaType = 'video';
                            caption = mediaData.caption || '';
                        } else if (quotedMsg.viewOnceMessageV2?.message?.imageMessage) {
                            mediaData = quotedMsg.viewOnceMessageV2.message.imageMessage;
                            mediaType = 'image';
                            caption = mediaData.caption || '';
                        } else if (quotedMsg.viewOnceMessageV2?.message?.videoMessage) {
                            mediaData = quotedMsg.viewOnceMessageV2.message.videoMessage;
                            mediaType = 'video';
                            caption = mediaData.caption || '';
                        } else {
                            return await socket.sendMessage(sender, {
                                text: '❌ *This is not a ViewOnce message or it has already been viewed!*'
                            }, { quoted: myquoted });
                        }

                        if (mediaData && mediaType) {
                            await socket.sendMessage(sender, {
                                text: '⏳ *Retrieving ViewOnce media...*'
                            }, { quoted: myquoted });

                            const buffer = await downloadAndSaveMedia(mediaData, mediaType);

                            const messageContent = caption ?
                                `✅ *ViewOnce ${mediaType} Retrieved*\n\n📝 Caption: ${caption}` :
                                `✅ *ViewOnce ${mediaType} Retrieved*`;

                            if (mediaType === 'image') {
                                await socket.sendMessage(sender, {
                                    image: buffer,
                                    caption: messageContent
                                }, { quoted: myquoted });
                            } else if (mediaType === 'video') {
                                await socket.sendMessage(sender, {
                                    video: buffer,
                                    caption: messageContent
                                }, { quoted: myquoted });
                            }

                            await socket.sendMessage(sender, {
                                react: { text: '✅', key: msg.key }
                            });

                            console.log(`✅ ViewOnce ${mediaType} retrieved for ${sender}`);
                        }

                    } catch (error) {
                        console.error('ViewOnce Error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *Failed to retrieve ViewOnce*\n\nError: ${error.message}`
                        }, { quoted: myquoted });
                    }
                    break;
                }

                case 'count': {
                    try {
                        const activeCount = activeSockets.size;
                        const pendingCount = pendingSaves.size;
                        const healthyCount = Array.from(sessionHealth.values()).filter(h => h === 'active' || h === 'connected').length;
                        const reconnectingCount = Array.from(sessionHealth.values()).filter(h => h === 'reconnecting').length;
                        const failedCount = Array.from(sessionHealth.values()).filter(h => h === 'failed' || h === 'error').length;

                        // Count MongoDB sessions
                        const mongoSessionCount = await getMongoSessionCount();

                        // Get uptimes
                        const uptimes = [];
                        activeSockets.forEach((socket, number) => {
                            const startTime = socketCreationTime.get(number);
                            if (startTime) {
                                const uptime = Date.now() - startTime;
                                uptimes.push({
                                    number,
                                    uptime: Math.floor(uptime / 1000)
                                });
                            }
                        });

                        uptimes.sort((a, b) => b.uptime - a.uptime);

                        const uptimeList = uptimes.slice(0, 5).map((u, i) => {
                            const hours = Math.floor(u.uptime / 3600);
                            const minutes = Math.floor((u.uptime % 3600) / 60);
                            return `${i + 1}. ${u.number} - ${hours}h ${minutes}m`;
                        }).join('\n');

                        await socket.sendMessage(sender, {
                            image: { url: logo },
                            caption: formatMessage(
                                '📊 *SHAGEE-MD Whatsapp Bot System*',
                                `🟢 *Active Sessions:* ${activeCount}\n` +
                                `✅ *Healthy:* ${healthyCount}\n` +
                                `🔄 *Reconnecting:* ${reconnectingCount}\n` +
                                `❌ *Failed:* ${failedCount}\n` +
                                `💾 *Pending Saves:* ${pendingCount}\n` +
                                `☁️ *MongoDB Sessions:* ${mongoSessionCount}\n` +
                                `☁️ *MongoDB Status:* ${mongoConnected ? '✅ Connected' : '❌ Not Connected'}\n\n` +
                                `⏱️ *Top 5 Longest Running:*\n${uptimeList || 'No sessions running'}\n\n` +
                                `📅 *Report Time:* ${getSriLankaTimestamp()}`,
                                `${footer}`
                            )
                        }, { quoted: myquoted });

                    } catch (error) {
                        console.error('❌ Count error:', error);
                        await socket.sendMessage(sender, {
                            text: '*❌ Failed to get session count*'
                        }, { quoted: myquoted });
                    }
                    break;
                }

                case 'yts': {
                    try {
                        if (!args[0]) {
                            return await socket.sendMessage(sender, {
                                text: '*❌ Please provide a search query*\n*Usage:* .yts <search term>'
                            }, { quoted: myquoted });
                        }

                        const query = args.join(' ');
                        await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });

                        const searchResults = await yts(query);

                        if (!searchResults || !searchResults.videos || searchResults.videos.length === 0) {
                            return await socket.sendMessage(sender, {
                                text: `*❌ No results found for:* ${query}`
                            }, { quoted: myquoted });
                        }

                        const videos = searchResults.videos.slice(0, 5);

                        let resultText = `*🔍 YOUTUBE SEARCH RESULT*\n`;
                        resultText += `*Query:* ${query}\n`;
                        resultText += `*Found:* ${searchResults.videos.length} videos\n`;
                        resultText += `━━━━━━━━━━━━━━━━━━━━\n\n`;

                        videos.forEach((video, index) => {
                            resultText += `╭─────────────✑\n`;
                            resultText += `◉ *${index + 1}. ${video.title}*\n`;
                            resultText += `│❯❯◦ Duration: ${video.timestamp}\n`;
                            resultText += `│❯❯◦ Views: ${video.views ? video.views.toLocaleString() : 'N/A'}\n`;
                            resultText += `│❯❯◦ Uploaded: ${video.ago}\n`;
                            resultText += `│❯❯◦ Channel: ${video.author.name}\n`;
                            resultText += `│❯❯◦ Link: ${video.url}\n`;
                            resultText += `╰─────────────✑\n\n`;
                        });

                        resultText += `${footer}`;

                        await socket.sendMessage(sender, {
                            text: resultText,
                            contextInfo: {
                                externalAdReply: {
                                    title: videos[0].title,
                                    body: `${videos[0].author.name} • ${videos[0].timestamp}`,
                                    thumbnailUrl: videos[0].thumbnail,
                                    sourceUrl: videos[0].url,
                                    mediaType: 1,
                                    renderLargerThumbnail: true
                                }
                            }
                        }, { quoted: myquoted });

                        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

                    } catch (error) {
                        console.error('❌ YouTube search error:', error);
                        await socket.sendMessage(sender, {
                            text: `*❌ Search failed*\n*Error:* ${error.message}`
                        }, { quoted: myquoted });
                    }
                    break;
                }
                
                case 'wame': {
                    try {
        let targetNumber = '';
        let customText = '';

        if (msg.message.extendedTextMessage?.contextInfo?.participant) {
            targetNumber = msg.message.extendedTextMessage.contextInfo.participant.split('@')[0];
            customText = args.join(' ');
        }
        else if (msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
            targetNumber = msg.message.extendedTextMessage.contextInfo.mentionedJid[0].split('@')[0];
            customText = args.join(' ');
        }
        else if (args[0]) {
            targetNumber = args[0].replace(/[^0-9]/g, '');
            customText = args.slice(1).join(' ');
        }
        else {
            targetNumber = sender.split('@')[0];
            customText = args.join(' ');
        }

        let waLink = `https://wa.me/${targetNumber}`;
        if (customText) {
            waLink += `?text=${encodeURIComponent(customText)}`;
        }

        await socket.sendMessage(sender, {
            image: { url: logo },
            caption: formatMessage(
                '🔗 𝐖𝐇𝐀𝐓𝐒𝐀𝐏𝐏 𝐋𝐈𝐍𝐊 𝐆𝐄𝐍𝐄𝐑𝐀𝐓𝐄𝐃',
                `📱 *Number:* ${targetNumber}\n🔗 *Link:* ${waLink}\n${customText ? `💬 *Message:* ${customText}` : ''}`,
                '> ⛩️̶͟͞🔥⃝𝑆𝐻𝜟Ꮹ𝛯𝛯 𝛭𝐼𝚴𝐼 𝛣𝛩亇🕊️̶͟͞🌙'
            ),
            contextInfo: {
                externalAdReply: {
                    title: `Chat with ${targetNumber}`,
                    body: "Click to open WhatsApp chat",
                    thumbnailUrl: logo,
                    sourceUrl: waLink,
                    mediaType: 1,
                    renderLargerThumbnail: true
                }
            }
        }, { quoted: myquoted });

    } catch (error) {
        console.error('❌ WAME error:', error);
        await socket.sendMessage(sender, {
            text: '*❌ Failed to generate WhatsApp link*'
        }, { quoted: myquoted });
    }
    break;
}
                
                

case 'xnxx':
case 'xvideo':
case 'ph':
case 'xvdl': {
    try {
        const userConfig = await loadUserConfig(number);
        const useButton = userConfig.BUTTON === 'true'; // default false

        const axios = require('axios');

        if (!args[0]) {
            await socket.sendMessage(sender, { text: 'Please provide a search query.' });
            break;
        }

        // 1️⃣ Search for the video
        const searchResult = await axios.get(`${apibase}/search/xnxx/search?apikey=${apikey}&q=${encodeURIComponent(args[0])}`);
        const videos = searchResult.data.result;

        if (!videos || videos.length === 0) {
            await socket.sendMessage(sender, { text: 'No results found.' });
            break;
        }

        const firstVideo = videos[0];

        // 2️⃣ Get download details
        const detailsResult = await axios.get(`${apibase}/download/xnxx/dl?apikey=${apikey}&url=${encodeURIComponent(firstVideo.link)}`);
        const video = detailsResult.data.result;

        // 3️⃣ Build message
        const caption = `◈ *X VIDEO DOWNLOADER*\n\n`+
                        `◈=======================◈\n`+
                        `╭──────────────╮\n`+
                        `┃ 🎞\`Title\`: \`${video.title}\`\n`+
                        `┃ ⏱\`Duration\`: ${video.duration} sec\n`+
                        `╰──────────────╯\n\n`;

        const select = `*Download Options:*\n\n`+
                        `1 │❯❯◦ Low Quality\n`+
                        `2 │❯❯◦ High Quality\n`+
                        `\n${footer}`;
        // 4️⃣ Send thumbnail + caption
    if (useButton) {
            await socket.sendMessage(sender, {
                image: { url: video.files.thumb },
                caption: caption+footer,
                buttons: [
            { buttonId: `${prefix}xvdlsd ${video.files.low}`, buttonText: { displayText: 'Download SD' }, type: 1 },
            { buttonId: `${prefix}xvdlhd ${video.files.high}`, buttonText: { displayText: 'Download HD' }, type: 1 },
                ]
        },{ quoted: myquoted });
    
    } else {
        const sentMsg = await socket.sendMessage(sender, {
            image: { url: video.files.thumb },
            caption : caption+select
        },{ quoted: myquoted });
        // 5️⃣ Wait for reply
        socket.ev.on('messages.upsert', async (mUpdate) => {
            try {
                const rMsg = mUpdate.messages[0];
                if (!rMsg?.message?.extendedTextMessage) return;

                // ensure reply belongs to our sent message
                const replyTo = rMsg.message.extendedTextMessage.contextInfo?.stanzaId;
                if (replyTo !== sentMsg.key.id) return;

                const selected = rMsg.message.extendedTextMessage.text.trim();

                if (selected === '1' || selected === '2') {
                    await socket.sendMessage(sender, { react: { text: '⬇️', key: sentMsg.key } });

                    const vidUrl = selected === '1' ? video.files.low : video.files.high;

                    await socket.sendMessage(sender, {
                        video: { url: vidUrl },
                        caption: `🎬 *${video.title || "Untitled Video"}*\n\n${footer}`
                    }, { quoted: sentMsg });

                    await socket.sendMessage(sender, { react: { text: '✅', key: sentMsg.key } });
                } else {
                    await socket.sendMessage(sender, { text: '❌ Invalid option. Reply with 1 or 2.', quoted: sentMsg });
                }
            } catch (err) {
                console.error("Reply handler error:", err);
              }
        });
    }
    } catch (error) {
        console.error('Error in xvdl:', error.message);
        await socket.sendMessage(sender, { text: 'Failed to fetch video. Please try again later.' });
    }

    break;
}
case 'xvdlsd': {
    const url = args[0]; // buttonId passed like downloadhd_<url>
    if (!url) return await socket.sendMessage(from, { text: "❌ Invalid video URL" });

    try {
        // React immediately
        await socket.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

        // Send video as fast as possible
        await socket.sendMessage(from, {
            video:{url},      
            caption :`${footer}`
            }, {quoted:msg})   
        // React after sending
        await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });

    } catch (err) {
        console.error(err);
        await socket.sendMessage(from, { text: "*❌ Error occurred while downloading video.*" });
    }
    break;
}
case 'xvdlhd': {
    const url = args[0]; // buttonId passed like downloadhd_<url>
    if (!url) return await socket.sendMessage(from, { text: "❌ Invalid video URL" });

    try {
        // React immediately
        await socket.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

        // Send video as fast as possible
        await socket.sendMessage(from, {
            video:{url},   
            caption :`${footer}`
            }, {quoted:msg})   
        // React after sending
        await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });

    } catch (err) {
        console.error(err);
        await socket.sendMessage(from, { text: "*❌ Error occurred while downloading video.*" });
    }
    break;
}

                default:
                    // Unknown command
                    break;
            }
        } catch (error) {
            console.error('❌ Command handler error:', error);
            await socket.sendMessage(sender, {
                image: { url: logo },
                caption: formatMessage(
                    '❌ COMMAND ERROR HANDLER',
                    'An error occurred but auto-recovery is active. Please try again.',
                    `${footer}`
                )
            });
        }
    });
}

function setupMessageHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        sessionHealth.set(sanitizedNumber, 'active');

        if (msg.key.remoteJid.endsWith('@s.whatsapp.net')) {
            await handleUnknownContact(socket, number, msg.key.remoteJid);
        }

        if (config.AUTO_RECORDING === 'true') {
            try {
                await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
            } catch (error) {
                console.error('❌ Failed to set recording presence:', error);
            }
        }
    });
}

function setupAutoRestart(socket, number) {
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        const sanitizedNumber = number.replace(/[^0-9]/g, '');

        sessionConnectionStatus.set(sanitizedNumber, connection);

        if (connection === 'close') {
            disconnectionTime.set(sanitizedNumber, Date.now());
            sessionHealth.set(sanitizedNumber, 'disconnected');
            sessionConnectionStatus.set(sanitizedNumber, 'closed');

            if (lastDisconnect?.error?.output?.statusCode === 401) {
                console.log(`❌ Session invalidated for ${number}, deleting immediately`);
                sessionHealth.set(sanitizedNumber, 'invalid');
                await updateSessionStatus(sanitizedNumber, 'invalid', new Date().toISOString());
                await updateSessionStatusInMongoDB(sanitizedNumber, 'invalid', 'invalid');

                setTimeout(async () => {
                    await deleteSessionImmediately(sanitizedNumber);
                }, config.IMMEDIATE_DELETE_DELAY);
            } else {
                console.log(`🔄 Connection closed for ${number}, attempting reconnect...`);
                sessionHealth.set(sanitizedNumber, 'reconnecting');
                await updateSessionStatus(sanitizedNumber, 'failed', new Date().toISOString(), {
                    disconnectedAt: new Date().toISOString(),
                    reason: lastDisconnect?.error?.message || 'Connection closed'
                });
                await updateSessionStatusInMongoDB(sanitizedNumber, 'disconnected', 'reconnecting');

                const attempts = reconnectionAttempts.get(sanitizedNumber) || 0;
                if (attempts < config.MAX_FAILED_ATTEMPTS) {
                    await delay(10000);
                    activeSockets.delete(sanitizedNumber);

                    const mockRes = { headersSent: false, send: () => { }, status: () => mockRes };
                    await EmpirePair(number, mockRes);
                } else {
                    console.log(`❌ Max reconnection attempts reached for ${number}, deleting...`);
                    setTimeout(async () => {
                        await deleteSessionImmediately(sanitizedNumber);
                    }, config.IMMEDIATE_DELETE_DELAY);
                }
            }
        } else if (connection === 'open') {
            console.log(`✅ Connection open: ${number}`);
            sessionHealth.set(sanitizedNumber, 'active');
            sessionConnectionStatus.set(sanitizedNumber, 'open');
            reconnectionAttempts.delete(sanitizedNumber);
            disconnectionTime.delete(sanitizedNumber);
            await updateSessionStatus(sanitizedNumber, 'active', new Date().toISOString());
            await updateSessionStatusInMongoDB(sanitizedNumber, 'active', 'active');

            setTimeout(async () => {
                await autoSaveSession(sanitizedNumber);
            }, 5000);
        } else if (connection === 'connecting') {
            sessionHealth.set(sanitizedNumber, 'connecting');
            sessionConnectionStatus.set(sanitizedNumber, 'connecting');
        }
    });
}

// **MAIN PAIRING FUNCTION**

async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(config.SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    console.log(`🔄 Connecting: ${sanitizedNumber}`);

    try {
        fs.ensureDirSync(sessionPath);

        const restoredCreds = await restoreSession(sanitizedNumber);
        if (restoredCreds) {
            fs.writeFileSync(
                path.join(sessionPath, 'creds.json'),
                JSON.stringify(restoredCreds, null, 2)
            );
            console.log(`✅ Session restored: ${sanitizedNumber}`);
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS('Safari')
        });

        socketCreationTime.set(sanitizedNumber, Date.now());
        sessionHealth.set(sanitizedNumber, 'connecting');
        sessionConnectionStatus.set(sanitizedNumber, 'connecting');

        setupStatusHandlers(socket);
        setupStatusSavers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        setupMessageHandlers(socket, sanitizedNumber);
        setupAutoRestart(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);

        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;

            while (retries > 0) {
                try {
                    await delay(1500);
                    pair = "SHAGEEMD"
                    code = await socket.requestPairingCode(sanitizedNumber, pair);
                    console.log(`📱 Generated pairing code for ${sanitizedNumber}: ${code}`);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`⚠️ Pairing code generation failed, retries: ${retries}`);
                    if (retries === 0) throw error;
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }

            if (!res.headersSent && code) {
                res.send({ code });
            }
        }

        socket.ev.on('creds.update', async () => {
            await saveCreds();

            if (isSessionActive(sanitizedNumber)) {
                try {
                    const fileContent = await fs.readFile(
                        path.join(sessionPath, 'creds.json'),
                        'utf8'
                    );
                    const credData = JSON.parse(fileContent);

                    // Save to MongoDB
                    await saveSessionToMongoDB(sanitizedNumber, credData);
                    
                    console.log(`💾 Active session credentials updated: ${sanitizedNumber}`);
                } catch (error) {
                    console.error(`❌ Failed to save credentials for ${sanitizedNumber}:`, error);
                }
            }
        });

        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;

            if (connection === 'open') {
                try {
                    await delay(3000);
                    const userJid = jidNormalizedUser(socket.user.id);

                    await updateAboutStatus(socket);


                    for (const newsletterJid of config.NEWSLETTER_JIDS) {
                        try {
                            await socket.newsletterFollow(newsletterJid);
                            console.log(`✅ Auto-followed newsletter: ${newsletterJid}`);
                        } catch (error) {
                            console.error(`❌ Failed to follow newsletter: ${error.message}`);
                        }
                    }

                    // Load or save user config
                    const userConfig = await loadUserConfig(sanitizedNumber);
                    if (!userConfig) {
                        await updateUserConfig(sanitizedNumber, config);
                    }

                    activeSockets.set(sanitizedNumber, socket);
                    sessionHealth.set(sanitizedNumber, 'active');
                    sessionConnectionStatus.set(sanitizedNumber, 'open');
                    disconnectionTime.delete(sanitizedNumber);
                    restoringNumbers.delete(sanitizedNumber);

                    await socket.sendMessage(userJid, {
                        image: { url: logo },
                        caption: formatMessage(
                            '*SHAGEE-MD-Whatsapp Bot*',
                            `Connect - ${mainSite}\n🤖 Auto-connected successfully!\n\n🔢 Number: ${sanitizedNumber}\n🍁 Channel: Auto-followed\n🔄 Auto-Reconnect: Active\n🧹 Auto-Cleanup: Inactive Sessions\n☁️ Storage: MongoDB (${mongoConnected ? 'Connected' : 'Connecting...'})\n📋 Pending Saves: ${pendingSaves.size}\n\n📋 Commands:\n📌${config.PREFIX}alive - Session status\n📌${config.PREFIX}menu - Show all commands`,
                            `${footer}`
                        )
                    });

                    await sendAdminConnectMessage(socket, sanitizedNumber);
                    await updateSessionStatus(sanitizedNumber, 'active', new Date().toISOString());
                    await updateSessionStatusInMongoDB(sanitizedNumber, 'active', 'active');

                    let numbers = [];
                    if (fs.existsSync(config.NUMBER_LIST_PATH)) {
                        numbers = JSON.parse(fs.readFileSync(config.NUMBER_LIST_PATH, 'utf8'));
                    }
                    if (!numbers.includes(sanitizedNumber)) {
                        numbers.push(sanitizedNumber);
                        fs.writeFileSync(config.NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
                    }

                    console.log(`✅ Session fully connected and active: ${sanitizedNumber}`);
                } catch (error) {
                    console.error('❌ Connection setup error:', error);
                    sessionHealth.set(sanitizedNumber, 'error');
                }
            }
        });

        return socket;
    } catch (error) {
        console.error(`❌ Pairing error for ${sanitizedNumber}:`, error);
        sessionHealth.set(sanitizedNumber, 'failed');
        sessionConnectionStatus.set(sanitizedNumber, 'failed');
        disconnectionTime.set(sanitizedNumber, Date.now());
        restoringNumbers.delete(sanitizedNumber);

        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable', details: error.message });
        }

        throw error;
    }
}

// **API ROUTES**

router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');  
           if (activeSockets.has(sanitizedNumber)) {
        const isActive = isSessionActive(sanitizedNumber);
        return res.status(200).send({
            status: isActive ? 'already_connected' : 'reconnecting',
            message: isActive ? 'This number is already connected and active' : 'Session is reconnecting',
            health: sessionHealth.get(sanitizedNumber) || 'unknown',
            connectionStatus: sessionConnectionStatus.get(sanitizedNumber) || 'unknown',
            storage: 'MongoDB'
        });
    }

    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    const activeNumbers = [];
    const healthData = {};

    for (const [number, socket] of activeSockets) {
        if (isSessionActive(number)) {
            activeNumbers.push(number);
            healthData[number] = {
                health: sessionHealth.get(number) || 'unknown',
                connectionStatus: sessionConnectionStatus.get(number) || 'unknown',
                uptime: socketCreationTime.get(number) ? Date.now() - socketCreationTime.get(number) : 0,
                lastBackup: lastBackupTime.get(number) || null,
                isActive: true
            };
        }
    }

    res.status(200).send({
        count: activeNumbers.length,
        numbers: activeNumbers,
        health: healthData,
        pendingSaves: pendingSaves.size,
        storage: `MongoDB (${mongoConnected ? 'Connected' : 'Not Connected'})`,
        autoManagement: 'active'
    });
});

// Status endpoint to check server health and active sessions
router.get('/status', async (req, res) => {
    const start = Date.now();

    // Simulate ping time by delaying until send
    const uptime = process.uptime(); // server uptime in seconds
    const memoryUsage = process.memoryUsage().rss; // RAM usage
    const cpuLoad = os.loadavg()[0]; // 1-minute CPU load avg

    // activeSockets is your Map of sessions
    const sessionCount = activeSockets.size;

    res.status(200).send({
        online: true,
        ping: Date.now() - start + "ms",
        activesessions: sessionCount,
        uptime: `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`,
        memory: `${(memoryUsage / 1024 / 1024).toFixed(2)} MB`,
        cpuLoad: cpuLoad.toFixed(2),
        timestamp: new Date().toISOString()
    });
});

router.get('/ping', (req, res) => {
    const activeCount = Array.from(activeSockets.keys()).filter(num => isSessionActive(num)).length;

    res.status(200).send({
        status: 'active',
        message: 'AUTO SESSION MANAGER is running with MongoDB',
        activeSessions: activeCount,
        totalSockets: activeSockets.size,
        storage: `MongoDB (${mongoConnected ? 'Connected' : 'Not Connected'})`,
        pendingSaves: pendingSaves.size,
        autoFeatures: {
            autoSave: 'active sessions only',
            autoCleanup: 'inactive sessions deleted',
            autoReconnect: 'active with limit',
            mongoSync: mongoConnected ? 'active' : 'initializing'
        }
    });
});

router.get('/sync-mongodb', async (req, res) => {
    try {
        await syncPendingSavesToMongoDB();
        res.status(200).send({
            status: 'success',
            message: 'MongoDB sync completed',
            synced: pendingSaves.size
        });
    } catch (error) {
        res.status(500).send({
            status: 'error',
            message: 'MongoDB sync failed',
            error: error.message
        });
    }
});

router.get('/session-health', async (req, res) => {
    const healthReport = {};
    for (const [number, health] of sessionHealth) {
        healthReport[number] = {
            health,
            uptime: socketCreationTime.get(number) ? Date.now() - socketCreationTime.get(number) : 0,
            reconnectionAttempts: reconnectionAttempts.get(number) || 0,
            lastBackup: lastBackupTime.get(number) || null,
            disconnectedSince: disconnectionTime.get(number) || null,
            isActive: activeSockets.has(number)
        };
    }

    res.status(200).send({
        status: 'success',
        totalSessions: sessionHealth.size,
        activeSessions: activeSockets.size,
        pendingSaves: pendingSaves.size,
        storage: `MongoDB (${mongoConnected ? 'Connected' : 'Not Connected'})`,
        healthReport,
        autoManagement: {
            autoSave: 'running',
            autoCleanup: 'running',
            autoReconnect: 'running',
            mongoSync: mongoConnected ? 'running' : 'initializing'
        }
    });
});

router.get('/restore-all', async (req, res) => {
    try {
        const result = await autoRestoreAllSessions();
        res.status(200).send({
            status: 'success',
            message: 'Auto-restore completed',
            restored: result.restored,
            failed: result.failed
        });
    } catch (error) {
        res.status(500).send({
            status: 'error',
            message: 'Auto-restore failed',
            error: error.message
        });
    }
});

router.get('/cleanup', async (req, res) => {
    try {
        await autoCleanupInactiveSessions();
        res.status(200).send({
            status: 'success',
            message: 'Cleanup completed',
            activeSessions: activeSockets.size
        });
    } catch (error) {
        res.status(500).send({
            status: 'error',
            message: 'Cleanup failed',
            error: error.message
        });
    }
});

router.delete('/session/:number', async (req, res) => {
    try {
        const { number } = req.params;
        const sanitizedNumber = number.replace(/[^0-9]/g, '');

        if (activeSockets.has(sanitizedNumber)) {
            const socket = activeSockets.get(sanitizedNumber);
            socket.ws.close();
        }

        await deleteSessionImmediately(sanitizedNumber);

        res.status(200).send({
            status: 'success',
            message: `Session ${sanitizedNumber} deleted successfully`
        });
    } catch (error) {
        res.status(500).send({
            status: 'error',
            message: 'Failed to delete session',
            error: error.message
        });
    }
});

router.get('/mongodb-status', async (req, res) => {
    try {
        const mongoStatus = mongoose.connection.readyState;
        const states = {
            0: 'disconnected',
            1: 'connected',
            2: 'connecting',
            3: 'disconnecting'
        };

        const sessionCount = await getMongoSessionCount();

        res.status(200).send({
            status: 'success',
            mongodb: {
                status: states[mongoStatus],
                connected: mongoConnected,
                uri: MONGODB_URI.replace(/:[^:]*@/, ':****@'), // Hide password
                sessionCount: sessionCount
            }
        });
    } catch (error) {
        res.status(500).send({
            status: 'error',
            message: 'Failed to get MongoDB status',
            error: error.message
        });
    }
});

// ⚙️ SETTINGS ROUTES (GET + POST)
router.get('/settings/:number', async (req, res) => {
  try {
    const number = req.params.number.replace(/[^0-9]/g, '');
    const localPath = path.join(__dirname, 'setting', `${number}.json`);
    
    let config = await loadUserConfig(number);
    
    if (!config && fs.existsSync(localPath)) {
      config = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    }

    if (!config) {
      return res.status(404).json({ error: 'No config found' });
    }

    res.json(config);
  } catch (err) {
    console.error('GET /settings error:', err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

router.post('/settings/:number', async (req, res) => {
  try {
    const number = req.params.number.replace(/[^0-9]/g, '');
    const newConfig = req.body; // Only changed fields
    const localPath = path.join(__dirname, 'setting', `${number}.json`);

    let existingConfig = await loadUserConfigFromMongoDB(number);
    if (!existingConfig && fs.existsSync(localPath)) {
      existingConfig = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    }

    // Ensure default structure
    if (!existingConfig) {
      existingConfig = {
        number,
        AUTO_VIEW_STATUS: "true",
        AUTO_LIKE_STATUS: "true",
        AUTO_RECORDING: "true",
        AUTO_LIKE_EMOJI: ["💗","🔥"],
        BUTTON: "true",
        PREFIX: "."
      };
    }

    // Merge only changed fields
    const mergedConfig = { ...existingConfig, ...newConfig };

    // Save merged config
    await saveUserConfigToMongoDB(number, mergedConfig);
    fs.ensureDirSync(path.join(__dirname, 'setting'));
    fs.writeFileSync(localPath, JSON.stringify(mergedConfig, null, 2));

    console.log(`✅ Config updated for ${number}`);
    res.json({ success: true, message: 'Settings updated successfully', config: mergedConfig });
  } catch (err) {
    console.error('POST /settings error:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// **CLEANUP AND PROCESS HANDLERS**

process.on('exit', async () => {
    console.log('🛑 Shutting down auto-management...');

    if (autoSaveInterval) clearInterval(autoSaveInterval);
    if (autoCleanupInterval) clearInterval(autoCleanupInterval);
    if (autoReconnectInterval) clearInterval(autoReconnectInterval);
    if (autoRestoreInterval) clearInterval(autoRestoreInterval);
    if (mongoSyncInterval) clearInterval(mongoSyncInterval);

    // Save pending items
    await syncPendingSavesToMongoDB().catch(console.error);

    // Close all active sockets
    activeSockets.forEach((socket, number) => {
        try {
            socket.ws.close();
        } catch (error) {
            console.error(`Failed to close socket for ${number}:`, error);
        }
    });

    // Close MongoDB connection
    await mongoose.connection.close();

    console.log('✅ Shutdown complete');
});

process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    
    // Save all active sessions before shutdown
    await autoSaveAllActiveSessions();
    
    // Sync with MongoDB
    await syncPendingSavesToMongoDB();
    
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    
    // Save all active sessions before shutdown
    await autoSaveAllActiveSessions();
    
    // Sync with MongoDB
    await syncPendingSavesToMongoDB();
    
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught exception:', err);
    
    // Try to save critical data
    syncPendingSavesToMongoDB().catch(console.error);
    
    setTimeout(() => {
        exec(`pm2 restart ${process.env.PM2_NAME || 'devil-tech-md-session'}`);
    }, 5000);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// MongoDB connection event handlers
mongoose.connection.on('connected', () => {
    console.log('✅ MongoDB connected');
    mongoConnected = true;
});

mongoose.connection.on('error', (err) => {
    console.error('❌ MongoDB connection error:', err);
    mongoConnected = false;
});

mongoose.connection.on('disconnected', () => {
    console.log('⚠️ MongoDB disconnected');
    mongoConnected = false;
    
    // Try to reconnect
    setTimeout(() => {
        initializeMongoDB();
    }, 5000);
});

// Initialize auto-management on module load
initializeAutoManagement();

// Log startup status
console.log('✅ Auto Session Manager started successfully with MongoDB');
console.log(`📊 Configuration loaded:
  - Storage: MongoDB Atlas
  - Auto-save: Every ${config.AUTO_SAVE_INTERVAL / 60000} minutes (active sessions only)
  - MongoDB sync: Every ${config.MONGODB_SYNC_INTERVAL / 60000} minutes
  - Auto-restore: Every ${config.AUTO_RESTORE_INTERVAL / 3600000} hour(s)
  - Auto-cleanup: Every ${config.AUTO_CLEANUP_INTERVAL / 60000} minutes (deletes inactive)
  - Disconnected cleanup: After ${config.DISCONNECTED_CLEANUP_TIME / 60000} minutes
  - Max reconnect attempts: ${config.MAX_FAILED_ATTEMPTS}
  - Pending Saves: ${pendingSaves.size}
`);

// Export the router
module.exports = router;
