// backend/src/utils/date.util.js
const { startOfDay, setHours, setMinutes, addMinutes, isBefore } = require('date-fns');

/**
 * Calcula os horários disponíveis de um profissional para uma data específica.
 * @param {Date} dataEscolhida - O dia para o qual deseja calcular os slots.
 * @param {Array} agendamentosDoDia - Lista de agendamentos já existentes no banco para este dia.
 * @param {Object} configProfissional - Objeto contendo workStart, workEnd e serviceDuration.
 * @returns {Array} - Array de objetos Date representando o início de cada slot livre.
 */
function calcularHorariosLivres(dataEscolhida, agendamentosDoDia, configProfissional) {
    const horariosDisponiveis = [];
    
    // 1. Pega configurações do Profissional (ou usa padrões de segurança)
    const inicioStr = configProfissional.workStart || "09:00";
    const fimStr = configProfissional.workEnd || "18:00";
    const duracao = configProfissional.serviceDuration || 60; // Minutos

    // 2. Converte strings "09:00" para objetos de Data
    const [hInicio, mInicio] = inicioStr.split(':').map(Number);
    const [hFim, mFim] = fimStr.split(':').map(Number);

    // Define o ponto de partida (Abertura) e o limite (Fechamento)
    let slotAtual = setMinutes(setHours(startOfDay(dataEscolhida), hInicio), mInicio);
    const horaFimExpediente = setMinutes(setHours(startOfDay(dataEscolhida), hFim), mFim);
    
    const agora = new Date();

    // 3. Loop: Enquanto houver tempo para atender um cliente antes de fechar
    while (addMinutes(slotAtual, duracao) <= horaFimExpediente) {
        
        // Regra: Não mostrar horários que já passaram (se for hoje)
        if (isBefore(slotAtual, agora)) {
            slotAtual = addMinutes(slotAtual, duracao);
            continue;
        }

        // Calcula o intervalo deste slot (Início -> Fim)
        const inicioSlot = new Date(slotAtual);
        const fimSlot = addMinutes(slotAtual, duracao);

        // 4. Verifica colisão com agendamentos existentes
        const estaOcupado = agendamentosDoDia.some(appt => {
            // Ignora cancelados ou faltas
            if (appt.status === 'CANCELED' || appt.status === 'CANCELLED' || appt.status === 'NO_SHOW') return false;
            
            // Assume que o agendamento já marcado também tem a mesma duração
            const inicioAppt = new Date(appt.date);
            const fimAppt = addMinutes(inicioAppt, duracao);

            // Lógica de Interseção de Horários Corrigida:
            // O Slot colide se começar ANTES do agendamento terminar E terminar DEPOIS do agendamento começar
            return (inicioSlot < fimAppt && fimSlot > inicioAppt);
        });

        if (!estaOcupado) {
            horariosDisponiveis.push(new Date(slotAtual));
        }

        // Avança para o próximo horário
        slotAtual = addMinutes(slotAtual, duracao);
    }

    return horariosDisponiveis;
}

module.exports = { calcularHorariosLivres };