// backend/src/services/email.service.js

const { Resend } = require('resend');

// Inicializar Resend com API Key (use variável de ambiente)
const resend = new Resend(process.env.RESEND_API_KEY || 're_Y2nV1DoP_KLf6WgC8Rfa9EUpNovEavsJ5');

async function enviarEmailVerificacao(destino, codigo) {
  console.log(`📧 [EMAIL] Iniciando envio via Resend para: ${destino}`);
  
  try {
    const { data, error } = await resend.emails.send({
      from: 'Markaí <noreply@markai.app>', // Seu domínio próprio!
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
              💡 <em>Dica:</em> Se você não solicitou este código, ignore este email.
            </p>
          </div>

          <!-- Footer -->
          <div style="background-color: #f4f6f9; padding: 25px 30px; text-align: center; border-top: 1px solid #e0e0e0;">
            <p style="color: #888; font-size: 12px; margin: 0;">
              © 2026 Markaí - Todos os direitos reservados
            </p>
            <p style="color: #999; font-size: 11px; margin: 10px 0 0 0;">
              Este é um email automático, por favor não responda.
            </p>
          </div>

        </div>
      `,
    });

    if (error) {
      console.error("❌ [EMAIL] Erro Resend:", error);
      throw new Error(error.message);
    }

    console.log("✅ [EMAIL] Email enviado com sucesso via Resend!");
    console.log("   📧 Para:", destino);
    console.log("   🆔 ID:", data?.id);
    console.log("   ⚠️  IMPORTANTE: Verifique a pasta SPAM/LIXO ELETRÔNICO");
    console.log("   🔗 Dashboard: https://resend.com/emails");
    return true;

  } catch (error) {
    console.error("❌ [EMAIL] Erro ao enviar via Resend:", error.message);
    if (error.statusCode) {
      console.error("   Status:", error.statusCode);
    }
    throw error;
  }
}

module.exports = { enviarEmailVerificacao };