const axios = require('axios');
const fs = require('fs');
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, 'src/config/moltbook-credentials.json');

async function registerBot() {
    console.log('🦞 Registrando bot no Moltbook...\n');

    // Lista de nomes para tentar
    const possibleNames = [
        'AlphaBotIA',
        'AlphaBotIA_BR',
        'AlphaBot_IA',
        'AlphaBotBR',
        'AlphaAssistant',
        'AlphaBot_' + Date.now().toString().slice(-4),
        'BotAlpha_' + Math.random().toString(36).substring(2, 6).toUpperCase()
    ];

    for (const name of possibleNames) {
        try {
            console.log(`⏳ Tentando registrar: ${name}...`);
            
            const response = await axios.post(
                'https://www.moltbook.com/api/v1/agents/register',
                {
                    name: name,
                    twitter_handle: null
                },
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 30000
                }
            );

            // DEBUG: Mostrar resposta completa
            console.log('\n📦 Resposta do servidor:');
            console.log(JSON.stringify(response.data, null, 2));
            console.log('');

            // Salvar credenciais completas
            const credentials = {
                name: name,
                api_key: response.data.api_key || response.data.apiKey,
                claim_url: response.data.claim_url || response.data.claimUrl || response.data.claim,
                verification_code: response.data.verification_code || response.data.verificationCode,
                profile_url: response.data.profile_url || response.data.profileUrl,
                registered_at: new Date().toISOString(),
                full_response: response.data // Salvar resposta completa para debug
            };

            // Criar diretório se não existir
            const dir = path.dirname(CREDENTIALS_PATH);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2));

            console.log('✅ SUCESSO!\n');
            console.log('═'.repeat(60));
            console.log(`\n🤖 Bot registrado: ${name}\n`);
            console.log('📋 Credenciais salvas em:');
            console.log(`   ${CREDENTIALS_PATH}\n`);

            // Mostrar todas as possíveis URLs
            if (credentials.claim_url) {
                console.log('🔗 CLAIM URL:\n');
                console.log(`   ${credentials.claim_url}\n`);
            }
            
            if (credentials.profile_url) {
                console.log('👤 Profile URL:\n');
                console.log(`   ${credentials.profile_url}\n`);
            }

            if (credentials.verification_code) {
                console.log('🔐 Verification Code:\n');
                console.log(`   ${credentials.verification_code}\n`);
            }

            console.log('═'.repeat(60));

            // Se temos claim_url, preparar para Twitter
            if (credentials.claim_url) {
                console.log('\n🐦 PRÓXIMOS PASSOS:\n');
                console.log('OPÇÃO 1 - MANUAL:');
                console.log('1. Vá para https://twitter.com/compose/tweet');
                console.log('2. Cole este texto:\n');
                console.log(`   Registrando ${name} no Moltbook 🦞`);
                console.log(`   ${credentials.claim_url}\n`);
                console.log('3. Poste o tweet');
                console.log('4. Aguarde alguns minutos\n');

                console.log('OPÇÃO 2 - AUTOMÁTICO:');
                console.log('1. Configure credenciais do Twitter (veja TWITTER_SETUP.md)');
                console.log('2. Execute: node post-to-twitter.js\n');

                // Salvar texto do tweet
                const tweetText = `Registrando ${name} no Moltbook 🦞\n${credentials.claim_url}`;
                
                fs.writeFileSync(
                    path.join(__dirname, 'TWEET.txt'),
                    `${tweetText}\n\n---\n\n` +
                    `Copie o texto acima e poste no Twitter para ativar o bot.`
                );

                console.log('📝 Texto do tweet salvo em: TWEET.txt\n');
            } else {
                console.log('\n⚠️  ATENÇÃO: Nenhuma claim_url foi retornada!');
                console.log('Verifique a resposta completa salva em moltbook-credentials.json\n');
            }

            console.log('═'.repeat(60));
            console.log('');

            return credentials;

        } catch (error) {
            if (error.response?.data?.error === 'Agent name already taken') {
                console.log(`   ⚠️  Nome "${name}" já existe, tentando próximo...\n`);
                continue;
            } else {
                console.error(`\n❌ Erro: ${error.response?.data?.error || error.message}`);
                if (error.response?.data) {
                    console.log('\n📦 Resposta completa do erro:');
                    console.log(JSON.stringify(error.response.data, null, 2));
                }
                throw error;
            }
        }
    }

    console.error('\n❌ Todos os nomes já estão em uso!\n');
    process.exit(1);
}

registerBot().catch(error => {
    console.error('\n❌ Erro fatal:', error.message);
    process.exit(1);
});