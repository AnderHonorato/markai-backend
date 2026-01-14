// backend/src/services/email.service.js

const nodemailer = require('nodemailer');

// Configuração do transportador com timeouts otimizados
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com", 
  port: 587, // Mudado de 465 para 587 (mais rápido)
  secure: false, // false para porta 587
  auth: {
    user: "contato.markaiapp@gmail.com", 
    pass: "ptwe ablp glsw fzun", 
  },
  // Timeouts importantes para produção
  connectionTimeout: 10000, // 10 segundos para conectar
  greetingTimeout: 10000,   // 10 segundos para cumprimento SMTP
  socketTimeout: 15000,      // 15 segundos por operação
  tls: {
    rejectUnauthorized: false // Aceita certificados auto-assinados
  },
  pool: true, // Usar pool de conexões (mais eficiente)
  maxConnections: 5,
  maxMessages: 100
});

// Verificar conexão na inicialização
transporter.verify(function(error, success) {
  if (error) {
    console.error("❌ [EMAIL] Erro ao conectar SMTP:", error.message);
  } else {
    console.log("✅ [EMAIL] Servidor SMTP pronto para enviar emails");
  }
});

async function enviarEmailVerificacao(destino, codigo) {
  console.log(`📧 [EMAIL] Iniciando envio para: ${destino}`);
  
  try {
    // Timeout wrapper
    const enviarComTimeout = new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout ao enviar email'));
      }, 12000); // 12 segundos no total

      try {
        const info = await transporter.sendMail({
          from: '"Markaí App" <contato.markaiapp@gmail.com>',
          to: destino,
          subject: "🔐 Seu código de verificação Markaí",
          text: `Seu código de verificação é: ${codigo}`,
          html: `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f4f6f9; padding: 0;">
              
              <!-- Header -->
              <div style="background: linear-gradient(135deg, #004aad 0%, #0066cc 100%); padding: 40px 20px; text-align: center; border-radius: 0;">
                <h1 style="color: #ffffff; margin: 0; font-size: 32px; font-weight: bold; letter-spacing: 1px;">Markaí</h1>
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

        clearTimeout(timeout);
        console.log("✅ [EMAIL] Email enviado com sucesso! ID:", info.messageId);
        resolve(true);
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });

    await enviarComTimeout;
    return true;

  } catch (error) {
    console.error("❌ [EMAIL] Erro ao enviar:", error.message);
    
    // Log detalhado para debug
    if (error.code) {
      console.error("   Código do erro:", error.code);
    }
    if (error.command) {
      console.error("   Comando SMTP:", error.command);
    }
    
    throw error; // Propaga o erro para o controller tratar
  }
}

module.exports = { enviarEmailVerificacao };