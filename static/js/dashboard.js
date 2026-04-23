// ================================================
// CONFIG
// ================================================
const CAMINHO_ARQUIVO = 'Data/Relatorio base CTB/Radar.xlsx';

let dadosProcessados = null;
let unidadeAtual = 'SP';

const TRIBUTACOES = [
    'Lucro Presumido',
    'Lucro Real',
    'Simples Nacional'
];

const MAPA_UNIDADE = {
    "SP": "SP",
    "RJ": "RJ",
    "Santos": "Santos",
    "Goias": "Goias"
};

// ================================================
// DATAS
// ================================================
function getDiasUteisAbril2026() {
    const dias = [];
    for (let i = 1; i <= 30; i++) {
        const d = new Date(2026, 3, i);
        if (d.getDay() !== 0 && d.getDay() !== 6) dias.push(d);
    }
    return dias;
}

function formatarData(d) {
    return d.toLocaleDateString('pt-BR');
}

function isMesmaData(a, b) {
    return a && b &&
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();
}

function extrairData(valor) {
    if (!valor) return null;

    try {
        if (typeof valor === 'number') {
            const d = XLSX.SSF.parse_date_code(valor);
            return new Date(d.y, d.m - 1, d.d);
        }

        if (valor instanceof Date) {
            return new Date(valor.getFullYear(), valor.getMonth(), valor.getDate());
        }

        if (typeof valor === 'string') {
            const partes = valor.split(' ')[0];
            const [dia, mes, ano] = partes.split('/');

            if (dia && mes && ano) {
                return new Date(+ano, mes - 1, +dia);
            }

            const d = new Date(valor);
            if (!isNaN(d)) return d;
        }
    } catch (e) {
        console.warn("Erro ao converter data:", valor);
    }

    return null;
}

// ================================================
// CARREGAMENTO
// ================================================
async function carregarArquivo() {
    console.log("📥 Tentando carregar arquivo:", CAMINHO_ARQUIVO);

    const response = await fetch(CAMINHO_ARQUIVO);

    if (!response.ok) {
        throw new Error(`Arquivo não encontrado (${response.status})`);
    }

    const buffer = await response.arrayBuffer();

    const wb = XLSX.read(buffer, {
        type: 'array',
        cellDates: true
    });

    const nomeAba = wb.SheetNames[0];
    const sheet = wb.Sheets[nomeAba];

    const dados = XLSX.utils.sheet_to_json(sheet, {
        raw: true
    });

    return dados;
}

// ================================================
// NORMALIZAÇÃO
// ================================================
function normalizar(dados) {
    return dados.map(r => {
        const n = {};

        Object.keys(r).forEach(k => {
            const key = k.toLowerCase();

            if (key.includes('tribut')) n.Tributacao = r[k];
            else if (key.includes('import')) n.DataImportacao = r[k];
            else if (key.includes('datadocumentacao')) n.DataDocumentacao = r[k];
            else if (key.includes('documentacao')) n.Documentacao = r[k];
            else if (key.includes('unidade')) n.Unidade = r[k];
            else if (key.includes('segmento')) n.Segmento = r[k];
            else if (key.includes('id') && key.includes('cliente')) n.IdCliente = r[k];
            else if (key.includes('cliente')) n.Cliente = r[k];
            else if (key.includes('grupo')) n.Grupo = r[k];
            else if (key.includes('gerente')) n.Gerente = r[k];
            else if (key.includes('equipe')) n.EquipeAtendimento = r[k];
        });

        return n;
    });
}

function normalizarSegmento(seg) {
    if (!seg) return 'Outros';
    if (['Serviços', 'Associacao', 'Associação'].includes(seg)) {
        return 'Serviços';
    }
    return seg;
}

function deveUsarSegmento(unidade) {
    return unidade === 'SP' || unidade === 'Goias';
}

// ================================================
// FILTRO
// ================================================
function filtrarPorUnidade(dados, unidade) {
    const valor = MAPA_UNIDADE[unidade];
    return dados.filter(r => r.Unidade === valor);
}

// ================================================
// CÁLCULO
// ================================================
function calcularEvolucao(base, dias, campo) {
    const total = base.length;
    let pendente = total;
    const arr = [total];

    dias.forEach(dia => {
        const baixados = base.filter(r => {
            const d = extrairData(r[campo]);
            return d && isMesmaData(d, dia);
        }).length;
        pendente -= baixados;
        arr.push(pendente);
    });

    return arr;
}

function calcularDocumentacao(base, dias) {
    const total = base.length;
    let pendente = total;
    const resultado = [total];

    dias.forEach(dia => {
        const baixados = base.filter(r => {
            const status = String(r.Documentacao || '').trim().toLowerCase();
            if (status !== 'recebida') return false;
            const data = extrairData(r.DataDocumentacao);
            return data && isMesmaData(data, dia);
        }).length;
        pendente -= baixados;
        if (pendente < 0) pendente = 0;
        resultado.push(pendente);
    });

    return resultado;
}

function calcularPendenciaOperacaoReal(base, dias) {
    const pendImportacao = calcularEvolucao(base, dias, 'DataImportacao');
    const pendDoc = calcularDocumentacao(base, dias);
    return pendImportacao.map((v, i) => {
        const resultado = v - pendDoc[i];
        return resultado < 0 ? 0 : resultado;
    });
}

function calcularPercentual(base, dias) {
    const totalEvolucao = calcularEvolucao(base, dias, 'DataImportacao');
    const total = base.length;
    return {
        pend: totalEvolucao.map(v => (v / total) * 100),
        conc: totalEvolucao.map(v => ((total - v) / total) * 100)
    };
}

function agruparDados(dados, unidade) {
    const usarSegmento = deveUsarSegmento(unidade);
    if (!usarSegmento) {
        return { 'Todas as Pendências': dados };
    }
    const grupos = {};
    dados.forEach(r => {
        const chave = normalizarSegmento(r.Segmento);
        if (!grupos[chave]) grupos[chave] = [];
        grupos[chave].push(r);
    });
    return grupos;
}

// ================================================
// FORMATAÇÃO
// ================================================
function formatarPercentual(valor) {
    return `${Math.round(valor)}%`;
}

function gerarTextoVariacao(valorAtual, valorAnterior) {
    if (valorAnterior === undefined || valorAtual === undefined) return '';
    const diferenca = valorAnterior - valorAtual;
    if (diferenca > 0) {
        return `<span class="variation">▼${diferenca}</span> `;
    }
    return '';
}

// ================================================
// MODAL - FUNÇÃO GLOBAL
// ================================================
window.abrirModal = function(base, data, contexto = '') {
    console.log("🔍 abrirModal chamada!", { baseLength: base.length, data, contexto });
    
    let lista = [];
    if (data) {
        lista = base.filter(r => {
            const dataImportacao = extrairData(r.DataImportacao);
            return !dataImportacao || dataImportacao > data;
        });
    } else {
        lista = [...base];
    }
    
    console.log("📋 Lista filtrada:", lista.length);
    
    const modal = document.getElementById('modal');
    const modalQuantidade = document.getElementById('modalQuantidade');
    const modalData = document.getElementById('modalData');
    const modalTableBody = document.getElementById('modalTableBody');
    
    if (modalQuantidade) modalQuantidade.textContent = lista.length;
    if (modalData) modalData.textContent = data ? formatarData(data) : 'Início';
    
    if (modalTableBody) {
        modalTableBody.innerHTML = '';
        
        if (lista.length === 0) {
            const tr = document.createElement('tr');
            tr.innerHTML = '<td colspan="7" style="text-align: center;">Nenhuma pendência encontrada</td>';
            modalTableBody.appendChild(tr);
        } else {
            lista.forEach(r => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${r.IdCliente || '-'}</td>
                    <td>${r.Cliente || '-'}</td>
                    <td>${r.Grupo || '-'}</td>
                    <td>${r.Gerente || '-'}</td>
                    <td>${r.Tributacao || '-'}</td>
                    <td>${r.EquipeAtendimento || '-'}</td>
                    <td>${r.Segmento || '-'}</td>
                `;
                modalTableBody.appendChild(tr);
            });
        }
    }
    
    if (modal) {
        modal.style.display = 'block';
        console.log("✅ Modal aberto com sucesso!");
    } else {
        console.error("❌ Elemento modal não encontrado no DOM!");
    }
};

// ================================================
// CRIAÇÃO DE LINHAS
// ================================================
function criarLinha(nome, valores, base, dias, isPercentual = false, isTotalOuTributacao = false) {
    const tr = document.createElement('tr');

    const tdNome = document.createElement('td');
    tdNome.textContent = nome;
    tr.appendChild(tdNome);

    valores.forEach((v, i) => {
        const td = document.createElement('td');
        td.className = 'clickable';
        
        let valorDisplay = '';
        if (isPercentual) {
            valorDisplay = formatarPercentual(v);
        } else {
            valorDisplay = Math.round(v);
        }
        
        if (isTotalOuTributacao && i > 0 && !isPercentual) {
            const valorAnterior = valores[i - 1];
            const textoVariacao = gerarTextoVariacao(v, valorAnterior);
            if (textoVariacao) {
                td.innerHTML = `${textoVariacao}${valorDisplay}`;
            } else {
                td.textContent = valorDisplay;
            }
        } else {
            td.textContent = valorDisplay;
        }

        // Usar window.abrirModal para garantir que encontra a função
        td.onclick = (e) => {
            e.stopPropagation();
            const dataSelecionada = i === 0 ? null : dias[i - 1];
            window.abrirModal(base, dataSelecionada, nome);
        };

        tr.appendChild(td);
    });

    return tr;
}

// 🔥 LINHA DE PERCENTUAL COM BARRA FINA E GRADIENTE
function criarLinhaPercentual(nome, valores, tipo) {
    const tr = document.createElement('tr');
    
    const tdNome = document.createElement('td');
    tdNome.textContent = nome;
    tr.appendChild(tdNome);
    
    valores.forEach((v) => {
        const td = document.createElement('td');
        td.style.padding = '0';
        td.style.position = 'relative';
        
        const wrapper = document.createElement('div');
        wrapper.className = 'percent-wrapper';
        wrapper.style.position = 'relative';
        wrapper.style.display = 'flex';
        wrapper.style.alignItems = 'center';
        wrapper.style.justifyContent = 'flex-end';
        wrapper.style.padding = '12px 16px 12px 48px';
        wrapper.style.minHeight = '44px';
        
        const barBg = document.createElement('div');
        barBg.className = `percent-bar-bg ${tipo === 'danger' ? 'bar-danger' : 'bar-success'}`;
        const percentValue = Math.min(Math.round(v), 100);
        barBg.style.width = `calc(${percentValue}% - 4px)`;
        barBg.style.position = 'absolute';
        barBg.style.top = '50%';
        barBg.style.transform = 'translateY(-50%)';
        barBg.style.left = '0';
        barBg.style.height = '30px';
        barBg.style.borderRadius = '4px';
        
        const valueSpan = document.createElement('span');
        valueSpan.className = 'percent-value';
        valueSpan.style.position = 'relative';
        valueSpan.style.zIndex = '2';
        valueSpan.style.fontWeight = '700';
        valueSpan.style.fontSize = '0.85em';
        valueSpan.style.color = '#000000';
        valueSpan.textContent = formatarPercentual(v);
        
        wrapper.appendChild(barBg);
        wrapper.appendChild(valueSpan);
        td.appendChild(wrapper);
        tr.appendChild(td);
    });
    
    return tr;
}

// ================================================
// CRIAÇÃO DO BLOCO/QUADRO
// ================================================
function criarBloco(nomeGrupo, dados, dias) {
    const container = document.createElement('div');
    container.className = 'tributacao-section';

    const header = document.createElement('div');
    header.className = 'section-header';
    const titulo = document.createElement('h2');
    titulo.textContent = nomeGrupo;
    header.appendChild(titulo);
    container.appendChild(header);

    const scrollWrapper = document.createElement('div');
    scrollWrapper.className = 'scroll-wrapper';

    const tabela = document.createElement('table');
    tabela.className = 'dashboard-table';

    const thead = document.createElement('thead');
    const trHead = document.createElement('tr');
    trHead.innerHTML = '<th>Indicador</th><th>Início</th>';
    dias.forEach(d => {
        const th = document.createElement('th');
        th.textContent = formatarData(d);
        trHead.appendChild(th);
    });
    thead.appendChild(trHead);
    tabela.appendChild(thead);

    const tbody = document.createElement('tbody');

    // TOTAL
    const totalLinha = criarLinha('▶ Total', calcularEvolucao(dados, dias, 'DataImportacao'), dados, dias, false, true);
    totalLinha.classList.add('linha-total');
    tbody.appendChild(totalLinha);

    // PERCENTUAIS COM BARRAS
    const perc = calcularPercentual(dados, dias);
    const linhaPercPend = criarLinhaPercentual('% Pendente', perc.pend, 'danger');
    const linhaPercConc = criarLinhaPercentual('% Concluído', perc.conc, 'success');
    tbody.appendChild(linhaPercPend);
    tbody.appendChild(linhaPercConc);

    // DRILL DOWN
    let expandidoTotal = false;
    totalLinha.onclick = () => {
        expandidoTotal = !expandidoTotal;
        totalLinha.children[0].textContent = expandidoTotal ? '▼ Total' : '▶ Total';
        tbody.querySelectorAll('.nivel1, .nivel2').forEach(e => e.remove());
        if (!expandidoTotal) return;

        TRIBUTACOES.forEach(trib => {
            const base = dados.filter(d => d.Tributacao === trib);
            if (base.length === 0) return;

            const linhaTrib = criarLinha(`▶ ${trib}`, calcularEvolucao(base, dias, 'DataImportacao'), base, dias, false, true);
            linhaTrib.classList.add('linha-tributacao', 'nivel1');

            let expandidoTrib = false;
            linhaTrib.onclick = () => {
                expandidoTrib = !expandidoTrib;
                linhaTrib.children[0].textContent = expandidoTrib ? `▼ ${trib}` : `▶ ${trib}`;
                let next = linhaTrib.nextSibling;
                while (next && next.classList.contains('nivel2')) {
                    const temp = next;
                    next = next.nextSibling;
                    temp.remove();
                }
                if (!expandidoTrib) return;

                const doc = calcularDocumentacao(base, dias);
                const op = calcularPendenciaOperacaoReal(base, dias);
                const percTrib = calcularPercentual(base, dias);

                const linhas = [
                    criarLinha('Doc Pendente', doc, base, dias, false, false),
                    criarLinha('Pendência OP', op, base, dias, false, false),
                    criarLinhaPercentual('% Pendente', percTrib.pend, 'danger'),
                    criarLinhaPercentual('% Concluído', percTrib.conc, 'success')
                ];

                let referencia = linhaTrib;
                linhas.forEach(l => {
                    l.classList.add('nivel2');
                    l.children[0].style.paddingLeft = '30px';
                    referencia.parentNode.insertBefore(l, referencia.nextSibling);
                    referencia = l;
                });
            };
            tbody.insertBefore(linhaTrib, linhaPercPend);
        });
    };

    tabela.appendChild(tbody);
    scrollWrapper.appendChild(tabela);
    container.appendChild(scrollWrapper);
    return container;
}

// ================================================
// ATUALIZAR DASHBOARD
// ================================================
function atualizarDashboard(dados, dias, unidade) {
    const container = document.getElementById('dashboards-container');
    if (!container) return;
    container.innerHTML = '';
    const filtrados = filtrarPorUnidade(dados, unidade);
    const grupos = agruparDados(filtrados, unidade);
    Object.keys(grupos).forEach(nome => {
        container.appendChild(criarBloco(nome, grupos[nome], dias));
    });
}

// ================================================
// INIT
// ================================================
document.addEventListener('DOMContentLoaded', async () => {
    const dias = getDiasUteisAbril2026();
    const status = document.getElementById('statusMessage');

    try {
        let dados = await carregarArquivo();
        dados = normalizar(dados);
        dadosProcessados = dados;
        atualizarDashboard(dados, dias, 'SP');
        if (status) {
            status.innerHTML = '✅ Arquivo carregado com sucesso';
            status.style.color = '#27ae60';
        }
    } catch (e) {
        if (status) {
            status.innerHTML = '❌ Erro ao carregar arquivo';
            status.style.color = '#dc3545';
        }
        console.error(e);
    }

    // FILTRO POR BOTÕES
    const botoes = document.querySelectorAll('.btn-unidade');
    botoes.forEach(btn => {
        btn.addEventListener('click', () => {
            botoes.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const unidade = btn.getAttribute('data-unidade');
            unidadeAtual = unidade;
            if (dadosProcessados) {
                atualizarDashboard(dadosProcessados, dias, unidade);
            }
        });
    });

    // FECHAR MODAL
    const closeModalBtn = document.querySelector('.close-modal');
    const modal = document.getElementById('modal');
    
    if (closeModalBtn) {
        closeModalBtn.onclick = () => {
            if (modal) modal.style.display = 'none';
        };
    }
    
    window.onclick = (e) => {
        if (e.target === modal) {
            if (modal) modal.style.display = 'none';
        }
    };
    
    console.log("✅ Dashboard inicializado. Função abrirModal disponível:", typeof window.abrirModal);
});