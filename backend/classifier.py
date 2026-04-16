import base64
import requests
from openai import OpenAI


def classify_image(image_url: str, api_key: str, model: str, base_url: str) -> dict:
    """
    调用 Qwen 视觉模型判断图片是否含人物模特。
    返回 {'label': str, 'confidence': float}
    label 为 '模特图' 或 '静态图'
    """
    client = OpenAI(api_key=api_key, base_url=base_url)

    try:
        img_resp = requests.get(image_url, timeout=15, headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        })
        img_resp.raise_for_status()
        img_b64 = base64.b64encode(img_resp.content).decode('utf-8')
        content_type = img_resp.headers.get('Content-Type', 'image/jpeg').split(';')[0]
        data_url = f'data:{content_type};base64,{img_b64}'
    except Exception:
        data_url = image_url

    response = client.chat.completions.create(
        model=model,
        messages=[
            {
                'role': 'user',
                'content': [
                    {'type': 'image_url', 'image_url': {'url': data_url}},
                    {
                        'type': 'text',
                        'text': (
                            '请判断这张商品图片中是否有人物模特（真人或仿真人模特）。'
                            '只回答"模特图"或"静态图"，不要其他内容。'
                            '有人物则回答"模特图"，没有人物则回答"静态图"。'
                        )
                    }
                ]
            }
        ]
    )
    answer = response.choices[0].message.content.strip()
    if '模特' in answer:
        return {'label': '模特图', 'confidence': 1.0}
    return {'label': '静态图', 'confidence': 1.0}
