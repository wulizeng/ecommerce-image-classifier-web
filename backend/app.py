import os
import json
import uuid
import tempfile
from datetime import datetime
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from classifier import classify_image
from excel_handler import read_links, write_results

app = Flask(__name__)
CORS(app)

# 内存存储：upload 的行数据和 finalize 的结果文件
_uploaded_rows = {}   # session_key -> list of rows
_batch_results = {}   # session_key -> {path, name}


def get_config(req):
    api_key = req.headers.get('X-Api-Key', '').strip()
    model = req.headers.get('X-Model', 'qwen3.5-plus').strip()
    base_url = req.headers.get('X-Base-Url', '').strip()
    if not api_key:
        return None, 'X-Api-Key 请求头不能为空'
    if not base_url:
        return None, 'X-Base-Url 请求头不能为空'
    return {'api_key': api_key, 'model': model, 'base_url': base_url}, None


def build_download_name(original_name: str) -> str:
    base = os.path.splitext(original_name or '导入文件')[0]
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    return f'{base}_识别结果_{timestamp}.xlsx'


@app.route('/api/health')
def health():
    return jsonify({'status': 'ok'})


@app.route('/api/single', methods=['POST'])
def single():
    config, err = get_config(request)
    if err:
        return jsonify({'error': err}), 400
    data = request.get_json()
    image_url = data.get('url', '').strip()
    if not image_url:
        return jsonify({'error': '请输入图片 URL'}), 400
    try:
        result = classify_image(image_url, config['api_key'], config['model'], config['base_url'])
        return jsonify({'label': result['label'], 'url': image_url})
    except Exception as e:
        return jsonify({'error': f'识别失败: {str(e)}'}), 500


@app.route('/api/upload', methods=['POST'])
def upload():
    """解析 Excel，返回所有行数据和 session_key"""
    if 'file' not in request.files:
        return jsonify({'error': '未上传文件'}), 400
    f = request.files['file']
    original_name = f.filename or '导入文件.xlsx'

    tmp_fd, tmp_path = tempfile.mkstemp(suffix='.xlsx')
    os.close(tmp_fd)
    f.save(tmp_path)

    try:
        rows = read_links(tmp_path)
    except Exception as e:
        return jsonify({'error': f'Excel 解析失败: {str(e)}'}), 400
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

    session_key = str(uuid.uuid4())
    _uploaded_rows[session_key] = {'rows': rows, 'original_name': original_name}

    return jsonify({
        'session_key': session_key,
        'total': len(rows),
        'rows': rows
    })


@app.route('/api/classify-batch', methods=['POST'])
def classify_batch():
    """识别一批图片，每批建议 3-5 条"""
    config, err = get_config(request)
    if err:
        return jsonify({'error': err}), 400

    data = request.get_json()
    items = data.get('items', [])  # [{index, url, ...row fields}]

    results = []
    for item in items:
        image_url = item.get('url', '').strip()
        idx = item.get('index')
        row_data = item.get('row', {})
        if not image_url:
            results.append({'index': idx, 'label': '', 'status': '失败: 链接为空', 'row': row_data})
        else:
            try:
                result = classify_image(image_url, config['api_key'], config['model'], config['base_url'])
                results.append({'index': idx, 'label': result['label'], 'status': '成功', 'row': row_data})
            except Exception as e:
                results.append({'index': idx, 'label': '', 'status': f'失败: {str(e)}', 'row': row_data})

    return jsonify({'results': results})


@app.route('/api/finalize', methods=['POST'])
def finalize():
    """接收所有处理结果，生成 Excel，返回下载 key"""
    data = request.get_json()
    session_key = data.get('session_key', '')
    processed = data.get('processed', [])  # [{...row, label, status}]

    upload_info = _uploaded_rows.get(session_key, {})
    original_name = upload_info.get('original_name', '导入文件.xlsx')
    download_name = build_download_name(original_name)

    try:
        out_fd, out_path = tempfile.mkstemp(suffix='.xlsx')
        os.close(out_fd)
        write_results(processed, out_path)
        _batch_results[session_key] = {'path': out_path, 'name': download_name}
    except Exception as e:
        return jsonify({'error': str(e)}), 500

    # 清理上传缓存
    _uploaded_rows.pop(session_key, None)
    success = sum(1 for r in processed if r.get('status') == '成功')
    total = len(processed)
    return jsonify({
        'session_key': session_key,
        'download_name': download_name,
        'total': total,
        'success': success,
        'fail': total - success
    })


@app.route('/api/download')
def download():
    session_key = request.args.get('session_key', '')
    result = _batch_results.get(session_key)
    if not result or not os.path.exists(result['path']):
        return jsonify({'error': '无可下载文件'}), 404
    return send_file(result['path'], as_attachment=True,
                     download_name=result['name'],
                     mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
