# DOCUMENTAÇÕES OFICIAIS: DOWNLOAD DE XML NF-e PARA ERP

---

## 🏛️ FONTES OFICIAIS - GOVERNO

### 1. **Portal da Secretaria da Fazenda (SEFAZ)**

**Link Geral:**
https://www.sefaz.go.gov.br/ (varia por estado)

**Documentações Técnicas Principais:**

#### A) **Documentação da NF-e**
https://www.nfe.fazenda.gov.br/

- **Manual de Orientação ao Desenvolvedor:**
  https://www.nfe.fazenda.gov.br/portal/webServices.shtml

- **Especificações Técnicas (XML):**
  https://www.nfe.fazenda.gov.br/portal/listaConteudo.shtml?classpath=documentos/arquivos/Layouts&tipo=Documentacao%20Tecnica

- **Web Services (SOAP/REST):**
  https://www.nfe.fazenda.gov.br/portal/webServices.shtml

#### B) **Ambiente de Teste (Homologação)**
https://www.nfe.fazenda.gov.br/portal/desenvolvedor.shtml

#### C) **Download de Certificado Digital**
https://www.nfe.fazenda.gov.br/portal/emitente.shtml

---

### 2. **Sistema Federal de Armazenamento**

**Consulta e Download de NF-e via Distribuição:**

https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx

**Métodos SOAP disponíveis:**
- `NfeDistribuicaoDFe` - Distribuição de DF-e

**Documentação:**
https://www1.nfe.fazenda.gov.br/

---

### 3. **Portal da Receita Federal**

https://www.gov.br/receitafederal/pt-br

**Seção de Integração Fiscal:**
https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/sistemas

**EFD-Contribuições:**
https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/sistemas/efd-contribuicoes

---

## 📚 DOCUMENTAÇÕES TÉCNICAS ESPECÍFICAS

### 1. **Manual Técnico NF-e (Oficial)**

https://www.nfe.fazenda.gov.br/portal/listaConteudo.shtml?classpath=documentos/arquivos/Layouts

**Conteúdo:**
- Layout da NF-e (estrutura XML completa)
- Tipos de dados
- Validações obrigatórias
- Exemplos de XML
- Instruções de assinatura digital

**Arquivo:** `NF-e_v4.00.xsd` (schema XML)

---

### 2. **Web Services - Endpoints**

#### **Ambiente Produção:**

```
SEFAZ Nacional (distribuição): 
https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx

Consultoria (consulta de protocolos):
https://nfe.fazenda.gov.br/NfeConsultaProtocolo/NfeConsultaProtocolo.asmx
```

#### **Ambiente Homologação (Testes):**

```
https://hom.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx
```

---

### 3. **Manual de Integração - Certificado Digital**

**Documento oficial sobre uso de certificado:**

https://www.nfe.fazenda.gov.br/portal/listaConteudo.shtml?classpath=documentos/arquivos/Certificados

**Seções importantes:**
- Tipos de certificados aceitos (A1, A3)
- Como obter certificado ICP-Brasil
- Assinatura digital (PKCS#7)
- Validação de certificado

---

## 🔗 LINKS DIRETOS POR ESTADO (SEFAZ)

### **SEFAZ por Estado:**

| Estado | Link | Documentação |
|--------|------|--------------|
| **SP** | https://www.sefaz.sp.gov.br | https://www.nfe.fazenda.gov.br |
| **MG** | https://www.sefaz.mg.gov.br | https://www.nfe.fazenda.gov.br |
| **RJ** | https://www.sefaz.rj.gov.br | https://www.nfe.fazenda.gov.br |
| **BA** | https://www.sefaz.ba.gov.br | https://www.nfe.fazenda.gov.br |
| **RS** | https://www.sefaz.rs.gov.br | https://www.nfe.fazenda.gov.br |
| **SC** | https://www.sefaz.sc.gov.br | https://www.nfe.fazenda.gov.br |
| **PR** | https://www.sefaz.pr.gov.br | https://www.nfe.fazenda.gov.br |
| **PE** | https://www.sefaz.pe.gov.br | https://www.nfe.fazenda.gov.br |
| **CE** | https://www.sefaz.ce.gov.br | https://www.nfe.fazenda.gov.br |
| **GO** | https://www.sefaz.go.gov.br | https://www.nfe.fazenda.gov.br |

**Observação:** Todos usam webservices na URL: `https://www1.nfe.fazenda.gov.br/...`

---

## 📥 COMO BAIXAR XML DA NF-e

### **Método 1: Via Portal da SEFAZ (Manual)**

1. Acesse: https://www.nfe.fazenda.gov.br/portal/
2. Login com certificado digital
3. Consulte suas notas
4. Opção: Exportar XML

### **Método 2: Via Web Service (Automático - RECOMENDADO)**

**Endpoint:** `NfeDistribuicaoDFe` (Sistema Federal de Distribuição)

https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx

**Método SOAP:**
```xml
NfeDistribuicaoDFe(
  nfeDadosMsg: XML com CNPJ/CPF e chave da NF-e
)
```

**Retorno:** XML da nota fiscal

**Documentação:**
https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx?wsdl

---

## 🔐 USAR CERTIFICADO DIGITAL

### **1. Obter Certificado Digital ICP-Brasil**

**Autoridades Certificadoras Credenciadas:**

https://www.gov.br/cidadania/pt-br/acesso-a-informacao/ac/certificadores-credenciados

**Principais AC (Autoridades Certificadoras):**

| Fornecedor | Link | Custo |
|-----------|------|-------|
| **Serpro** | https://www.serpro.gov.br/certificados | ~R$ 180/ano |
| **Serasa** | https://www.serasa.com.br/certificados | ~R$ 200/ano |
| **Certisign** | https://www.certisign.com.br | ~R$ 250/ano |
| **Valid** | https://www.valid.com | ~R$ 200/ano |
| **Soluti** | https://www.soluti.com.br | ~R$ 150/ano |

---

### **2. Instalação em Sistema**

**Guia de instalação de certificado A1 (arquivo .pfx):**

https://www.nfe.fazenda.gov.br/portal/listaConteudo.shtml?classpath=documentos/arquivos/Certificados

**Passos principais:**
1. Obter arquivo `.pfx` + senha
2. Instalar em local específico (Windows: C:\Program Files\...)
3. Validar no sistema operacional
4. Usar para assinar XML

**Código Python (exemplo):**
```python
from M2Crypto import BIO, X509
import OpenSSL

# Carregar certificado
cert = X509.load_cert('caminho/cert.pem')

# Usar em assinatura PKCS#7
from OpenSSL.crypto import load_pkcs12
with open('caminho/cert.pfx', 'rb') as f:
    p12 = load_pkcs12(f.read(), b'senha')
    cert = p12.get_certificate()
    key = p12.get_privatekey()
```

---

## 📐 ESQUEMAS XML (XSD)

### **Arquivos XSD Oficiais:**

https://www.nfe.fazenda.gov.br/portal/listaConteudo.shtml?classpath=documentos/arquivos/Layouts

**Principais schemas:**
- `nfe_v4.00.xsd` - Estrutura completa da NF-e
- `tipos_v4.00.xsd` - Tipos de dados
- `cobr_v2.01.xsd` - Cobrança
- `cana_v2.00.xsd` - Setor canavieiro
- `cte_v2.00.xsd` - Conhecimento de Transporte

---

## 💻 EXEMPLOS DE CÓDIGO

### **Exemplo 1: Python - Baixar XML via Web Service**

```python
import zeep
from OpenSSL import SSL, crypto
import urllib3

# Desabilitar aviso SSL (cuidado em produção)
urllib3.disable_warnings()

# Carregar certificado
cert = crypto.load_certificate(
    crypto.FILETYPE_PEM, 
    open('certificado.pem').read()
)

key = crypto.load_privatekey(
    crypto.FILETYPE_PEM,
    open('chave_privada.pem').read()
)

# Criar contexto SSL
context = SSL.Context(SSL.TLSv1_2_METHOD)
context.use_certificate(cert)
context.use_privatekey(key)

# URL do WSDL
url_wsdl = 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx?wsdl'

# Criar cliente SOAP
client = zeep.Client(wsdl=url_wsdl)

# XML com dados para consulta
xml_dados = """
<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe">
    <distDFe>
        <CNPJ>00000000000000</CNPJ>
        <chNFe>3516000000000000000000650010000000001234567890</chNFe>
    </distDFe>
</nfeDadosMsg>
"""

# Chamar serviço
resposta = client.service.nfeDistribuicaoDFe(nfeDadosMsg=xml_dados)

print(resposta)
```

---

### **Exemplo 2: C# - Baixar e Processar XML**

```csharp
using System;
using System.Security.Cryptography.X509Certificates;
using System.Xml;

// Referência Web Service
// https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx

class Program
{
    static void Main()
    {
        // Carregar certificado
        var certificado = new X509Certificate2(
            "caminho/cert.pfx", 
            "senha_cert"
        );

        // Criar cliente SOAP
        var client = new NFeDistribuicaoDFe.NfeDistribuicaoDFeClient();
        client.ClientCredentials.ClientCertificate.Certificate = certificado;

        // XML para consulta
        string xmlDados = @"
            <nfeDadosMsg xmlns='http://www.portalfiscal.inf.br/nfe'>
                <distDFe>
                    <CNPJ>00000000000000</CNPJ>
                    <chNFe>3516000000000000000000650010000000001234567890</chNFe>
                </distDFe>
            </nfeDadosMsg>";

        // Chamar serviço
        string retorno = client.nfeDistribuicaoDFe(xmlDados);

        // Processar resposta XML
        XmlDocument xmlDoc = new XmlDocument();
        xmlDoc.LoadXml(retorno);

        // Extrair dados (exemplo)
        XmlNodeList nfeList = xmlDoc.GetElementsByTagName("NFe");
        foreach (XmlNode nfe in nfeList)
        {
            string chave = nfe.SelectSingleNode("infNFe").Attributes["Id"].Value;
            Console.WriteLine($"Chave: {chave}");
        }
    }
}
```

---

### **Exemplo 3: PHP - Baixar XML**

```php
<?php
// Usar biblioteca de SOAP
$wsdl = 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx?wsdl';

// Opções SSL
$options = array(
    'ssl' => array(
        'local_cert' => '/caminho/cert.pem',
        'local_pk' => '/caminho/chave.pem',
        'passphrase' => 'senha',
        'verify_peer' => false
    )
);

$context = stream_context_create($options);

// Cliente SOAP
$client = new SoapClient($wsdl, array(
    'stream_context' => $context,
    'local_cert' => '/caminho/cert.pem',
    'local_key' => '/caminho/chave.pem'
));

// XML de requisição
$xmlDados = <<<XML
<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe">
    <distDFe>
        <CNPJ>00000000000000</CNPJ>
        <chNFe>3516000000000000000000650010000000001234567890</chNFe>
    </distDFe>
</nfeDadosMsg>
XML;

// Chamar serviço
try {
    $resposta = $client->nfeDistribuicaoDFe(array('nfeDadosMsg' => $xmlDados));
    echo $resposta;
} catch (SoapFault $e) {
    echo "Erro: " . $e->getMessage();
}
?>
```

---

## 📋 DOCUMENTAÇÃO COMPLEMENTAR

### **1. Manual de Protocolos NFe**

https://www.nfe.fazenda.gov.br/portal/listaConteudo.shtml?classpath=documentos/arquivos/Protocolos

**Contém:**
- Fluxo de processamento
- Validações
- Respostas do sistema

### **2. Guia de Integração CT-e**

https://www.cte.fazenda.gov.br/portal/

(Similar para conhecimento de transporte)

### **3. Guia de Integração NFC-e**

https://www.nfce.fazenda.gov.br/portal/

(Para nota fiscal ao consumidor)

### **4. EFD-Contribuições (Arquivo Fiscal)**

https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/sistemas/efd-contribuicoes

**Para importação de notas em lote**

---

## 🔐 SEGURANÇA E BOAS PRÁTICAS

### **Documentação LGPD (Dados do Cliente)**

https://www.gov.br/cidadania/pt-br/acesso-a-informacao/lgpd

### **Validação de Certificados**

https://www.iti.gov.br/ (Instituto Nacional de Tecnologia da Informação)

**Verificação de certificados válidos:**
https://www.iti.gov.br/certificacao/listagem-de-ac-credenciadas

---

## 🛠️ FERRAMENTAS AUXILIARES

### **1. Validadores XML Online**

https://www.xmlvalidation.com/
https://jsoncrack.com/editor

### **2. Testar SOAP**

https://www.soapui.org/ (Ferramenta desktop)

### **3. Converter Certificado .pfx para .pem**

```bash
# Extrair certificado
openssl pkcs12 -in cert.pfx -out cert.pem -nodes

# Extrair apenas chave privada
openssl pkcs12 -in cert.pfx -nocerts -nodes -out key.pem
```

---

## 📞 CANAIS DE SUPORTE OFICIAL

### **1. Portal da NF-e**

https://www.nfe.fazenda.gov.br/portal/

**Seções:**
- Dúvidas frequentes
- Documentação técnica
- Status dos sistemas

### **2. SEFAZ do seu estado**

https://www.sefaz.sp.gov.br/ (exemplo SP)

### **3. Email de suporte**

nfe@fazenda.gov.br

### **4. Comunidade de Desenvolvedores**

https://www.nfe.fazenda.gov.br/portal/listaConteudo.shtml?classpath=comunidade

---

## 📝 EXEMPLO DE RESPOSTA (XML da NF-e)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe35160100000000000000650010000000001234567890">
        <!-- Dados da NF-e -->
        <ide>
            <cUF>35</cUF>
            <CNPJ>00000000000000</CNPJ>
            <assinaturaQRCode>...</assinaturaQRCode>
        </ide>
        <emit>
            <CNPJ>00000000000000</CNPJ>
            <xNome>NOME EMPRESA</xNome>
        </emit>
        <dest>
            <CNPJ>00000000000000</CNPJ>
        </dest>
        <det nItem="1">
            <prod>
                <code>123456</code>
                <xProd>DESCRIÇÃO DO PRODUTO</xProd>
                <CFOP>5102</CFOP>
                <uCom>UN</uCom>
                <qCom>1.0000</qCom>
                <vUnCom>100.00</vUnCom>
            </prod>
        </det>
        <total>
            <ICMSTot>
                <vBC>100.00</vBC>
                <vICMS>18.00</vICMS>
                <vProd>100.00</vProd>
                <vNF>118.00</vNF>
            </ICMSTot>
        </total>
    </infNFe>
    <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
        <!-- Assinatura digital -->
    </Signature>
</NFe>
```

---

## ✅ CHECKLIST DE IMPLEMENTAÇÃO

- [ ] Obter certificado digital ICP-Brasil (A1 ou A3)
- [ ] Consultar documentação em https://www.nfe.fazenda.gov.br
- [ ] Testar em ambiente de homologação
- [ ] Implementar parsing de XML (XPath ou DOM)
- [ ] Validar XML contra XSD
- [ ] Implementar assinatura digital (PKCS#7)
- [ ] Chamar web service de distribuição
- [ ] Processar resposta (protocolo)
- [ ] Importar dados no ERP
- [ ] Testar com NF-e real em produção

---

**Precisa de ajuda em alguma etapa específica?** 🚀
