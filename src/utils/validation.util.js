// backend/src/utils/validation.util.js

/**
 * Valida se um CPF é matematicamente válido.
 * @param {string} cpf - O CPF (com ou sem máscara).
 * @returns {boolean}
 */
function validarCPF(cpf) {
    if (!cpf) return false;

    // Remove caracteres não numéricos
    const cleanCPF = cpf.replace(/\D/g, '');

    // Verifica se tem 11 dígitos ou se são todos iguais (ex: 111.111.111-11)
    if (cleanCPF.length !== 11 || /^(\d)\1+$/.test(cleanCPF)) {
        return false;
    }

    // Validação do primeiro dígito
    let soma = 0;
    for (let i = 1; i <= 9; i++) {
        soma += parseInt(cleanCPF.substring(i - 1, i)) * (11 - i);
    }
    let resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cleanCPF.substring(9, 10))) return false;

    // Validação do segundo dígito
    soma = 0;
    for (let i = 1; i <= 10; i++) {
        soma += parseInt(cleanCPF.substring(i - 1, i)) * (12 - i);
    }
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cleanCPF.substring(10, 11))) return false;

    return true;
}

module.exports = { validarCPF };