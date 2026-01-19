// backend/src/utils/keep-alive.js

/**
 * 🔥 KEEP-ALIVE PARA RENDER.COM
 * Previne hibernação do servidor e mantém sessões WhatsApp ativas
 */

const https = require('https');
const http = require('http');

class KeepAlive {
    constructor(url, interval = 14 * 60 * 1000) { // 14 minutos
        this.url = url;
        this.interval = interval;
        this.timer = null;
        this.isRunning = false;
    }

    start() {
        if (this.isRunning) {
            console.log('⚠️ Keep-alive já está rodando');
            return;
        }

        console.log('🔥 Keep-alive INICIADO');
        console.log(`📍 URL: ${this.url}`);
        console.log(`⏱️ Intervalo: ${this.interval / 60000} minutos\n`);

        this.isRunning = true;
        this.ping(); // Primeiro ping imediato

        this.timer = setInterval(() => {
            this.ping();
        }, this.interval);
    }

    ping() {
        const timestamp = new Date().toISOString();
        
        try {
            const protocol = this.url.startsWith('https') ? https : http;
            
            protocol.get(this.url, (res) => {
                console.log(`[${timestamp}] ✅ Keep-alive ping: ${res.statusCode}`);
            }).on('error', (err) => {
                console.error(`[${timestamp}] ❌ Keep-alive erro:`, err.message);
            });
        } catch (error) {
            console.error(`[${timestamp}] 💥 Erro crítico no ping:`, error.message);
        }
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            this.isRunning = false;
            console.log('🛑 Keep-alive PARADO');
        }
    }
}

module.exports = KeepAlive;