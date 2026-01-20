// frontend/src/services/WhatsAppConnectionManager.js

/**
 * Gerenciador de Conexão WhatsApp - ANTI-DUPLICAÇÃO
 * Previne múltiplas requisições simultâneas
 */
class WhatsAppConnectionManager {
    constructor() {
        this.pendingRequest = null; // Promise da requisição em andamento
        this.isConnecting = false; // Flag de estado
        this.lastAttempt = 0; // Timestamp da última tentativa
        this.cooldownTime = 10000; // 10 segundos de cooldown
    }

    /**
     * Verifica se está em cooldown
     */
    isInCooldown() {
        const elapsed = Date.now() - this.lastAttempt;
        return elapsed < this.cooldownTime;
    }

    /**
     * Tempo restante de cooldown (em segundos)
     */
    getCooldownRemaining() {
        const elapsed = Date.now() - this.lastAttempt;
        const remaining = this.cooldownTime - elapsed;
        return Math.ceil(remaining / 1000);
    }

    /**
     * CONECTAR - com proteção anti-duplicação
     */
    async connect(userId, method, phoneNumber = null) {
        console.log('[ConnectionManager] Tentativa de conexão:', { userId, method });

        // 🚫 BLOQUEIA SE JÁ ESTÁ CONECTANDO
        if (this.isConnecting) {
            console.warn('[ConnectionManager] ⚠️ Bloqueado: Conexão já em andamento');
            throw new Error('CONEXAO_JA_EM_ANDAMENTO');
        }

        // 🚫 VERIFICA COOLDOWN
        if (this.isInCooldown()) {
            const remaining = this.getCooldownRemaining();
            console.warn(`[ConnectionManager] ⚠️ Cooldown ativo: ${remaining}s restantes`);
            throw new Error(`COOLDOWN_ATIVO: Aguarde ${remaining}s`);
        }

        try {
            // 🔒 ATIVA FLAGS
            this.isConnecting = true;
            this.lastAttempt = Date.now();

            console.log('[ConnectionManager] ✅ Iniciando conexão...');

            // Faz a requisição
            const response = await fetch('/api/whatsapp/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, method, phoneNumber })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || `HTTP ${response.status}`);
            }

            console.log('[ConnectionManager] ✅ Conectado:', data.type);
            return data;

        } catch (error) {
            console.error('[ConnectionManager] ❌ Erro:', error.message);
            throw error;
        } finally {
            // 🔓 SEMPRE LIBERA A FLAG
            this.isConnecting = false;
        }
    }

    /**
     * DESCONECTAR
     */
    async disconnect(userId) {
        console.log('[ConnectionManager] Desconectando:', userId);

        try {
            const response = await fetch('/api/whatsapp/disconnect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId })
            });

            const data = await response.json();
            console.log('[ConnectionManager] ✅ Desconectado');
            return data;

        } catch (error) {
            console.error('[ConnectionManager] ❌ Erro ao desconectar:', error);
            throw error;
        }
    }

    /**
     * VERIFICAR STATUS
     */
    async getStatus(userId) {
        try {
            const response = await fetch(`/api/whatsapp/status/${userId}`);
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('[ConnectionManager] ❌ Erro ao verificar status:', error);
            return { connected: false, state: 'error' };
        }
    }

    /**
     * LIMPEZA FORÇADA (emergência)
     */
    async forceCleanup() {
        console.log('[ConnectionManager] 🧹 Limpeza forçada');

        try {
            const response = await fetch('/api/whatsapp/force-cleanup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            const data = await response.json();
            console.log('[ConnectionManager] ✅ Sistema limpo');
            
            // Reseta estados locais
            this.isConnecting = false;
            this.lastAttempt = 0;
            
            return data;

        } catch (error) {
            console.error('[ConnectionManager] ❌ Erro na limpeza:', error);
            throw error;
        }
    }

    /**
     * RESET (limpa estados locais)
     */
    reset() {
        console.log('[ConnectionManager] 🔄 Reset local');
        this.isConnecting = false;
        this.lastAttempt = 0;
        this.pendingRequest = null;
    }
}

// Exporta instância única (singleton)
export default new WhatsAppConnectionManager();