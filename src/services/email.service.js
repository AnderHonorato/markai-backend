// backend/src/services/email.service.js

const { Resend } = require('resend');

// API Key configurada diretamente
const resend = new Resend('re_6Hicwqst_MrnvM2kJsWgYAYjbsDgwDsb5');

/**
 * 🔧 CONFIGURAÇÃO DE PRODUÇÃO:
 * 
 * ✅ Domínio verificado: xn--marka-3sa.app.br
 * ✅ Subdomínio de envio: send.xn--marka-3sa.app.br
 * ✅ Email remetente: noreply@send.xn--marka-3sa.app.br
 */

const SENDER_EMAIL = 'Markaí <noreply@send.xn--marka-3sa.app.br>';

async function enviarEmailVerificacao(destino, codigo) {
  console.log(`📧 [EMAIL] Iniciando envio via Resend para: ${destino}`);
  console.log(`📧 [EMAIL] Remetente: ${SENDER_EMAIL}`);
  
  try {
    const { data, error } = await resend.emails.send({
      from: SENDER_EMAIL,
      to: destino,
      subject: '🔐 Seu código de verificação Markaí',
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f4f6f9;">
          
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #004aad 0%, #0066cc 100%); padding: 40px 20px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 32px; font-weight: bold;">Markaí</h1>
            <p style="color: #e3f2fd; margin: 10px 0 0 0; font-size: 14px;">Conectando você aos melhores profissionais</p>
          </div>

          <!-- Body -->
          <div style="background-color: #ffffff; padding: 40px 30px;">
            <h2 style="color: #333; font-size: 24px; margin: 0 0 20px 0;">Bem-vindo ao Markaí! 🎉</h2>
            
            <p style="color: #555; font-size: 16px; line-height: 1.6; margin: 0 0 25px 0;">
              Estamos felizes em ter você conosco! Use o código abaixo para ativar sua conta:
            </p>

            <!-- Código -->
            <div style="background: linear-gradient(135deg, #e3f2fd 0%, #f0f4ff 100%); padding: 30px; text-align: center; border-radius: 12px; margin: 25px 0; border: 2px dashed #004aad;">
              <div style="font-size: 36px; font-weight: bold; color: #004aad; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                ${codigo}
              </div>
            </div>

            <p style="color: #666; font-size: 14px; line-height: 1.6; margin: 20px 0 0 0;">
              ⏰ <strong>Este código expira em 10 minutos.</strong>
            </p>

            <p style="color: #888; font-size: 13px; line-height: 1.6; margin: 25px 0 0 0; padding-top: 20px; border-top: 1px solid #eee;">
              🔒 <strong>Segurança:</strong> Nunca compartilhe este código com ninguém. Nossa equipe jamais solicitará este código por telefone, WhatsApp ou email.
            </p>

            <p style="color: #888; font-size: 13px; line-height: 1.6; margin: 10px 0 0 0;">
              💡 <em>Dica:</em> Se você não solicitou este código, ignore este email com segurança.
            </p>
          </div>

          <!-- Footer -->
          <div style="background-color: #f4f6f9; padding: 25px 30px; text-align: center; border-top: 1px solid #e0e0e0;">
            <p style="color: #888; font-size: 12px; margin: 0;">
              © ${new Date().getFullYear()} Markaí - Todos os direitos reservados
            </p>
            <p style="color: #999; font-size: 11px; margin: 10px 0 0 0;">
              Este é um email automático, por favor não responda.
            </p>
          </div>

        </div>
      `,
      text: `
MARKAÍ - Código de Verificação

Bem-vindo ao Markaí! 🎉

Seu código de verificação é: ${codigo}

⏰ Este código expira em 10 minutos.

🔒 IMPORTANTE: Nunca compartilhe este código com ninguém.

Se você não solicitou este código, ignore este email.

---
© ${new Date().getFullYear()} Markaí
      `.trim()
    });

    if (error) {
      console.error("❌ [EMAIL] Erro Resend:", {
        statusCode: error.statusCode,
        name: error.name,
        message: error.message
      });
      throw new Error(`Falha no envio: ${error.message || error.name}`);
    }

    console.log("✅ [EMAIL] Email enviado com sucesso via Resend!");
    console.log("   📧 Destinatário:", destino);
    console.log("   📤 Remetente:", SENDER_EMAIL);
    console.log("   🆔 ID da mensagem:", data?.id);
    console.log("   🔗 Dashboard: https://resend.com/emails");
    console.log("   💡 Lembre o usuário de verificar SPAM/LIXO ELETRÔNICO");
    
    return true;

  } catch (error) {
    console.error("❌ [EMAIL] Erro ao enviar via Resend:", error.message);
    
    if (error.statusCode === 403) {
      console.error("   🚫 ERRO 403: Domínio não verificado ou remetente inválido");
      console.error("   📋 Verifique:");
      console.error("      1. DNS records no painel Resend estão todos ✅");
      console.error("      2. Email remetente: noreply@send.xn--marka-3sa.app.br");
      console.error("      3. Aguarde até 30min para propagação DNS");
    } else if (error.statusCode === 429) {
      console.error("   ⏱️  ERRO 429: Limite de taxa excedido");
    } else if (error.statusCode) {
      console.error("   📊 Status HTTP:", error.statusCode);
    }
    
    throw error;
  }
}

module.exports = { enviarEmailVerificacao };
