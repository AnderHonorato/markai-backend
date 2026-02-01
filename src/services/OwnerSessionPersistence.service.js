// backend/src/services/OwnerSessionPersistence.service.js
// ✅ PERSISTÊNCIA COMPLETA DA SESSÃO DO OWNER - CORRIGIDO

const fs = require('fs');
const path = require('path');

class OwnerSessionPersistence {
    constructor() {
        // Diretório para salvar sessão do Owner
        this.sessionDir = path.join(__dirname, '../../auth_owner');
        this.metadataFile = path.join(__dirname, '../../owner_session_metadata.json');
        this.conversationStateFile = path.join(__dirname, '../../owner_conversation_state.json');
        
        this.ensureDirectories();
        
        console.log('💾 OwnerSessionPersistence inicializado');
    }

    /**
     * Garante que diretórios existem
     */
    ensureDirectories() {
        if (!fs.existsSync(this.sessionDir)) {
            fs.mkdirSync(this.sessionDir, { recursive: true });
            console.log('📁 Diretório de sessão do Owner criado');
        }
    }

    /**
     * Salva metadados da sessão
     */
    async saveMetadata(data) {
        try {
            const metadata = {
                connected: data.connected || false,
                number: data.number || null,
                connectedAt: data.connectedAt || new Date().toISOString(),
                lastActivity: new Date().toISOString(),
                paused: data.paused || false,
                respondGroups: data.respondGroups || false
            };

            fs.writeFileSync(
                this.metadataFile,
                JSON.stringify(metadata, null, 2),
                'utf8'
            );

            console.log('[Owner Session] 💾 Metadados salvos:', metadata.number);
            return true;
        } catch (error) {
            console.error('[Owner Session] ❌ Erro ao salvar metadados:', error.message);
            return false;
        }
    }

    /**
     * Carrega metadados da sessão
     */
    loadMetadata() {
        try {
            if (fs.existsSync(this.metadataFile)) {
                const data = fs.readFileSync(this.metadataFile, 'utf8');
                const metadata = JSON.parse(data);
                console.log('[Owner Session] 📖 Metadados carregados:', metadata.number);
                return metadata;
            }
            
            console.log('[Owner Session] ℹ️ Nenhum metadado encontrado');
            return null;
        } catch (error) {
            console.error('[Owner Session] ❌ Erro ao carregar metadados:', error.message);
            return null;
        }
    }

    /**
     * ✅ SALVA ESTADO DAS CONVERSAS (QUEM FOI BLOQUEADO, ETC)
     */
    async saveConversationState(state) {
        try {
            fs.writeFileSync(
                this.conversationStateFile,
                JSON.stringify(state, null, 2),
                'utf8'
            );
            console.log('[Owner Session] 💾 Estado de conversas salvo');
            return true;
        } catch (error) {
            console.error('[Owner Session] ❌ Erro ao salvar estado:', error.message);
            return false;
        }
    }

    /**
     * ✅ CARREGA ESTADO DAS CONVERSAS
     */
    loadConversationState() {
        try {
            if (fs.existsSync(this.conversationStateFile)) {
                const data = fs.readFileSync(this.conversationStateFile, 'utf8');
                const state = JSON.parse(data);
                console.log('[Owner Session] 📖 Estado de conversas carregado');
                return state;
            }
            return null;
        } catch (error) {
            console.error('[Owner Session] ❌ Erro ao carregar estado:', error.message);
            return null;
        }
    }

    /**
     * Verifica se existe sessão salva
     */
    hasSession() {
        try {
            // Verifica se o diretório de sessão tem arquivos
            if (fs.existsSync(this.sessionDir)) {
                const files = fs.readdirSync(this.sessionDir);
                const hasCredentials = files.some(f => f === 'creds.json');
                
                if (hasCredentials) {
                    const metadata = this.loadMetadata();
                    return metadata?.connected || false;
                }
            }
            return false;
        } catch (error) {
            console.error('[Owner Session] ❌ Erro ao verificar sessão:', error.message);
            return false;
        }
    }

    /**
     * Obtém caminho do diretório de sessão
     */
    getSessionPath() {
        return this.sessionDir;
    }

    /**
     * Limpa sessão salva
     */
    async clearSession() {
        try {
            // ✅ CORRIGIDO: fs.existsSync (era fs.existsExists)
            // Remove diretório de sessão
            if (fs.existsSync(this.sessionDir)) {
                fs.rmSync(this.sessionDir, { recursive: true, force: true });
                console.log('[Owner Session] 🗑️ Diretório de sessão removido');
            }

            // Remove metadados
            if (fs.existsSync(this.metadataFile)) {
                fs.unlinkSync(this.metadataFile);
                console.log('[Owner Session] 🗑️ Metadados removidos');
            }

            // Remove estado de conversas
            if (fs.existsSync(this.conversationStateFile)) {
                fs.unlinkSync(this.conversationStateFile);
                console.log('[Owner Session] 🗑️ Estado de conversas removido');
            }

            // Recria diretório vazio
            this.ensureDirectories();

            return true;
        } catch (error) {
            console.error('[Owner Session] ❌ Erro ao limpar sessão:', error.message);
            return false;
        }
    }

    /**
     * Atualiza última atividade
     */
    async updateLastActivity() {
        try {
            const metadata = this.loadMetadata();
            if (metadata) {
                metadata.lastActivity = new Date().toISOString();
                await this.saveMetadata(metadata);
            }
        } catch (error) {
            console.error('[Owner Session] ❌ Erro ao atualizar atividade:', error.message);
        }
    }
}

// Singleton
const ownerSessionPersistence = new OwnerSessionPersistence();

module.exports = ownerSessionPersistence;