import requests
import os

# api_key = os.environ.get("GROQ_API_KEY")
api_key= "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"
url = "https://api.groq.com/openai/v1/models"

headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

response = requests.get(url, headers=headers)

print(response.json())