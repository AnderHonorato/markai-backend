// backend/src/services/SessionPersistence.js
const fs = require('fs');
const path = require('path');

/**
 * Gerencia a persistência de metadados de sessões WhatsApp
 * Permite restaurar sessões após reinicializações do servidor
 */
class SessionPersistence {
    constructor() {
        this.metadataFile = path.join(__dirname, '../../auth_sessions/sessions_metadata.json');
        this.authDir = path.join(__dirname, '../../auth_sessions');
        
        // Garante que o diretório existe
        if (!fs.existsSync(this.authDir)) {
            fs.mkdirSync(this.authDir, { recursive: true });
        }
        
        console.log('💾 SessionPersistence inicializado');
    }

    /**
     * Salva metadados de uma sessão ativa
     */
    saveSessionMetadata(userId, data = {}) {
        try {
            const metadata = this.loadAllMetadata();
            
            metadata[userId] = {
                userId,
                savedAt: new Date().toISOString(),
                lastConnected: data.lastConnected || new Date().toISOString(),
                phoneNumber: data.phoneNumber || null,
                status: data.status || 'active',
                connectionMethod: data.connectionMethod || 'qr'
            };
            
            fs.writeFileSync(
                this.metadataFile, 
                JSON.stringify(metadata, null, 2),
                'utf8'
            );
            
            console.log(`💾 Metadados salvos para: ${userId}`);
            return true;
            
        } catch (error) {
            console.error(`❌ Erro ao salvar metadados de ${userId}:`, error.message);
            return false;
        }
    }

    /**
     * Carrega todos os metadados
     */
    loadAllMetadata() {
        try {
            if (!fs.existsSync(this.metadataFile)) {
                return {};
            }
            
            const content = fs.readFileSync(this.metadataFile, 'utf8');
            return JSON.parse(content);
            
        } catch (error) {
            console.error('❌ Erro ao carregar metadados:', error.message);
            return {};
        }
    }

    /**
     * Carrega metadados de uma sessão específica
     */
    getSessionMetadata(userId) {
        const all = this.loadAllMetadata();
        return all[userId] || null;
    }

    /**
     * Remove metadados de uma sessão
     */
    removeSessionMetadata(userId) {
        try {
            const metadata = this.loadAllMetadata();
            delete metadata[userId];
            
            fs.writeFileSync(
                this.metadataFile, 
                JSON.stringify(metadata, null, 2),
                'utf8'
            );
            
            console.log(`🗑️ Metadados removidos: ${userId}`);
            return true;
            
        } catch (error) {
            console.error(`❌ Erro ao remover metadados de ${userId}:`, error.message);
            return false;
        }
    }

    /**
     * Lista todas as sessões que devem ser restauradas
     */
    getSessionsToRestore() {
        try {
            const metadata = this.loadAllMetadata();
            const sessions = [];
            
            // Verifica quais sessões têm arquivos de credenciais válidos
            for (const [userId, data] of Object.entries(metadata)) {
                const sessionDir = path.join(this.authDir, `session_${userId}`);
                const credsFile = path.join(sessionDir, 'creds.json');
                
                if (fs.existsSync(credsFile)) {
                    sessions.push({
                        userId,
                        ...data,
                        hasCredentials: true
                    });
                } else {
                    console.log(`⚠️ Sessão ${userId} sem credenciais válidas`);
                }
            }
            
            return sessions;
            
        } catch (error) {
            console.error('❌ Erro ao listar sessões para restaurar:', error.message);
            return [];
        }
    }

    /**
     * Limpa metadados de sessões sem arquivos
     */
    cleanOrphanedMetadata() {
        try {
            const metadata = this.loadAllMetadata();
            const cleaned = [];
            
            for (const userId of Object.keys(metadata)) {
                const sessionDir = path.join(this.authDir, `session_${userId}`);
                
                if (!fs.existsSync(sessionDir)) {
                    delete metadata[userId];
                    cleaned.push(userId);
                }
            }
            
            if (cleaned.length > 0) {
                fs.writeFileSync(
                    this.metadataFile, 
                    JSON.stringify(metadata, null, 2),
                    'utf8'
                );
                
                console.log(`🧹 Metadados órfãos removidos: ${cleaned.join(', ')}`);
            }
            
            return cleaned.length;
            
        } catch (error) {
            console.error('❌ Erro ao limpar metadados órfãos:', error.message);
            return 0;
        }
    }

    /**
     * Atualiza status de uma sessão
     */
    updateSessionStatus(userId, status) {
        try {
            const metadata = this.loadAllMetadata();
            
            if (metadata[userId]) {
                metadata[userId].status = status;
                metadata[userId].lastUpdated = new Date().toISOString();
                
                fs.writeFileSync(
                    this.metadataFile, 
                    JSON.stringify(metadata, null, 2),
                    'utf8'
                );
                
                return true;
            }
            
            return false;
            
        } catch (error) {
            console.error(`❌ Erro ao atualizar status de ${userId}:`, error.message);
            return false;
        }
    }

    /**
     * Estatísticas das sessões salvas
     */
    getStats() {
        try {
            const metadata = this.loadAllMetadata();
            const total = Object.keys(metadata).length;
            
            let active = 0;
            let withCredentials = 0;
            
            for (const [userId, data] of Object.entries(metadata)) {
                const sessionDir = path.join(this.authDir, `session_${userId}`);
                const credsFile = path.join(sessionDir, 'creds.json');
                
                if (data.status === 'active') active++;
                if (fs.existsSync(credsFile)) withCredentials++;
            }
            
            return {
                total,
                active,
                withCredentials,
                restorable: withCredentials
            };
            
        } catch (error) {
            console.error('❌ Erro ao obter estatísticas:', error.message);
            return { total: 0, active: 0, withCredentials: 0, restorable: 0 };
        }
    }
}

module.exports = new SessionPersistence();