#!/bin/bash

# Script para testar o fluxo de criação e acesso de ofertas na VM.

# --- Configuração ---
VM_IP="34.46.233.197"
PAYLOAD_JSON='{"ida":{"data":"24/05/2026","valor":158.93,"origem":"CGH","bagagem":"Apenas bagagem de mão","destino":"SDU","duracao":"1h 05m","escalas":"Direto","IdViagem":131124,"companhia":"AZUL","numero_voo":"AD 6054","horario_chegada":"12:00","horario_partida":"10:55","valor_formatado":"R$ 158,93","IdentificacaoDaViagem":"rQwAAB+LCAAAAAAABADlVmtv4jgU/Ssj70egxBAoIM0HkzSQKY8UQh+MqspNDGQJMRMnLaXqf99rh8LAsNJQaWZW2ojHfdjH9x4fW3lFBDVwHhmooeVRU/1aK9SY0FCwPBoGAjVKuKos20eNSgnGBhQ1EDFRHnXny+1YRznaGSAMIC/TLk9jg/vM9skyDDzqc7WAGyy5WtVkIgkiDmt8fUV9mDQkfZhmgjWwpeWAVdJK1YJWKZR0V9Ma6oOyJTRNwwX12WXe7qENKpgRUiEYDBqhLODSOJjAV9Y+Mjr9m1JNVqiiLk9oiBrndVU8ud60YY42hsXYxsrG95cshmZiumueQoAK1Z5hywYm2gTXKrgO1dVrBd0/xwVarmgFn1ZL+vl5razXMBRwzTftd1sx0Icg1IE/mfqOZzD7m6wvNvF1GoJLJG1Gqy1NuezQlA2bw33isNaoVDLi2jKFtUpFDjMOhpW2/LZlCpeUbaYx9SiXjOOGJif20gV4Va2igzNk0wWLEpm3Za082tGy74SSIXQtNxa2BLiUHtY0AzdbaE9BzR+Szc1saVrwb+Wk5bxbtscjud2zJFmKRrH4zPkjLQga+Y98dZbE9ImFYRDNzzy+OHuMi6NlyKlfDPmUL2jsUVGExJJGs4AGHscYny2jKeBadBGEkvBX1OMLtiMedB1M+fvymWdHCYujbdCJ2SRYSZeMR2qQ7OkvTcdML2W+xWGKDE7Ug94gqpSbicIYbPiyjH02LBoz92UJU7+C4Ld8OF0az9N3Eh2DbPJZE+bmEPzGZvYPk35wmsJAJKrPaxoquGHbefCnhJBmrmOQ7GkS0jFJ6bJeS156jrvuXoTOy7qHDbdjB46PjWF5vb7iF3fCv3zS1m0jzN1OLvpFo9e/sjves9tZiGL7y8SsO3orIAPzb5dcXs3snH6nh1P/JnXn7dZYVHPncfX6mxsuxsNofBtZy9zNfFycVqtpfANVpM1qWlS1kc+f1c0xhYL7kwmLbXlEBwwsFnkBdegq06kdTWiUBOHmBLzld43W9S1EksajKPCpz4S6V7yARzQQxGNCcHnpnoq9Bw33dsIWVDxkN3Ds0hU1+OIxhZsXjsTPgd9LeKXF0ehdjLs79EctOoOPaLELXX86FKSCOhRkhr8VZI6MvxMkPJZ1IEhLPf9RQVqz8aw1q9k9kwjcrZVXplHRkqKJjejq2dBeOl5u7hjlDq5dSeBcubfAYnpHvrDnkX17pxT5vxPk/ZHN+gXrQEjKHv2m9f51QzLyHz5AvjxQn3r8iR+BUwfvVMAjOCORwmHmJ0O1QF3hEbwB89JY/Dze4XwjZr6aFH6AsGO0E5ecjGPJwBGw7FokoIrTCXNY7MGrVnqUtQxYvVyfiqvl1YveccRs0B+/UO7f/gGrKgw8rQwAAA=="},"numero":2,"tipo_viagem":"somente_ida","valor_total":158.93,"valor_total_formatado":"R$ 158,93"}'
# --- Fim da Configuração ---

echo "--- Passo 1: Criando a oferta na VM ---"
# -sS para modo silencioso mas mostrando erros, -f para falhar em caso de erro HTTP
RESPONSE=$(curl -sS -f -X POST -H "Content-Type: application/json" -d "$PAYLOAD_JSON" "http://${VM_IP}/api/oferta")

if [ $? -ne 0 ]; then
  echo "Erro: Falha ao criar a oferta. A resposta do servidor foi:"
  echo "$RESPONSE"
  exit 1
fi

echo "Resposta do servidor: $RESPONSE"

# Extrai o ID da oferta do JSON de resposta (requer 'jq')
OFERTA_ID=$(echo "$RESPONSE" | jq -r '.id')

if [ -z "$OFERTA_ID" ] || [ "$OFERTA_ID" == "null" ]; then
  echo "Erro: Não foi possível extrair o ID da oferta da resposta."
  exit 1
fi

echo "Sucesso! ID da oferta gerado: $OFERTA_ID"
echo ""

# ---

echo "--- Passo 2: Acessando a URL da oferta (simulando o cliente) ---"
OFERTA_URL="http://${VM_IP}/?oferta=${OFERTA_ID}"
echo "Acessando URL: $OFERTA_URL"
echo ""

# -i para incluir os cabeçalhos HTTP na saída para depuração
curl -i "$OFERTA_URL"

echo ""
echo "--- Teste concluído ---"
echo "Verifique a saída acima. Se o HTML da página foi retornado, o teste funcionou."
echo "Se você viu um erro 404 ou outra mensagem, o frontend não conseguiu buscar os dados da oferta."
