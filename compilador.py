from pathlib import Path
import base64
import re

def compilar_html_standalone():
    base_path = Path(__file__).parent

    html_path = base_path / "index.html"
    css_path = base_path / "static" / "css" / "style.css"
    js_path = base_path / "static" / "js" / "dashboard.js"
    excel_path = base_path / "Data" / "Relatorio base CTB" / "Radar.xlsx"

    output_path = base_path / "index_final.html"

    # ================================
    # VERIFICAÇÃO
    # ================================
    for caminho in [html_path, css_path, js_path, excel_path]:
        if not caminho.exists():
            print(f"❌ Arquivo não encontrado: {caminho}")
            return

    print("📂 Lendo arquivos...")

    html = html_path.read_text(encoding="utf-8")
    css = css_path.read_text(encoding="utf-8")
    js = js_path.read_text(encoding="utf-8")

    # ================================
    # CONVERTER EXCEL PARA BASE64
    # ================================
    print("📦 Convertendo Excel para base64...")

    with open(excel_path, "rb") as f:
        excel_base64 = base64.b64encode(f.read()).decode()

    # ================================
    # AJUSTAR JS (REMOVER FETCH)
    # ================================
    print("⚙️ Ajustando JavaScript...")

    js = js.replace(
        "const response = await fetch(CAMINHO_ARQUIVO);",
        "// fetch removido para modo offline"
    )

    js = js.replace(
        "const buffer = await response.arrayBuffer();",
        """
function base64ToArrayBuffer(base64) {
    const binary = atob(BASE64_EXCEL);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

const buffer = base64ToArrayBuffer(BASE64_EXCEL);
"""
    )

    # ================================
    # EMBUTIR CSS
    # ================================
    html = re.sub(
        r'<link[^>]*style\.css[^>]*>',
        f"<style>\n{css}\n</style>",
        html
    )

    # ================================
    # EMBUTIR JS + EXCEL
    # ================================
    script_final = f"""
<script>
const BASE64_EXCEL = "{excel_base64}";
{js}
</script>
"""

    html = re.sub(
        r'<script[^>]*dashboard\.js[^>]*></script>',
        script_final,
        html
    )

    # ================================
    # SALVAR
    # ================================
    output_path.write_text(html, encoding="utf-8")

    print("\n✅ SUCESSO!")
    print(f"📄 Arquivo gerado: {output_path}")
    print("💡 Agora pode abrir com duplo clique (sem Live Server)")

# ================================
# EXECUÇÃO
# ================================
if __name__ == "__main__":
    compilar_html_standalone()