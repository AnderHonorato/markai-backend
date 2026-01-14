const nodemailer = require('nodemailer');

// Configuração do transportador (Exemplo usando Gmail ou Outlook)
// Dica: Para Gmail, use "App Passwords". Para testes rápidos, use o Mailtrap.
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com", 
  port: 465,
  secure: true, // true para 465, false para outras portas
  auth: {
    user: "contato.markaiapp@gmail.com", 
    pass: "ptwe ablp glsw fzun", 
  },
});

async function enviarEmailVerificacao(destino, codigo) {
  try {
    const info = await transporter.sendMail({
      from: '"Markaí App" <contato.markaiapp@gmail.com>',
      to: destino,
      subject: "Seu código de verificação Markaí",
      text: `Seu código de verificação é: ${codigo}`,
      html: `
        <div style="font-family: sans-serif; color: #333;">
          <h2>Bem-vindo ao Markaí!</h2>
          <p>Use o código abaixo para ativar sua conta:</p>
          <div style="background: #f0f4ff; padding: 20px; font-size: 24px; font-weight: bold; color: #004aad; text-align: center; border-radius: 10px;">
            ${codigo}
          </div>
          <p>Este código expira em 10 minutos.</p>
        </div>
      `,
    });
    console.log("📧 E-mail enviado: %s", info.messageId);
    return true;
  } catch (error) {
    console.error("❌ Erro ao enviar e-mail:", error);
    return false;
  }
}

module.exports = { enviarEmailVerificacao };