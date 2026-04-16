import os
import sys
import json
import tempfile
from datetime import datetime
from flask import Flask, jsonify, request, send_file, Response
from flask_cors import CORS
from classifier import classify_image
from excel_handler import read_links, write_results

app = Flask(__name__)
CORS(app)  # 允许所有来源

# 批量任务结果临时存储（进程内，按 session key 区分）
_batch_results = {}


def get_config(req):
    """从请求头提取配置，缺失则返回错误信息"""
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


@app.route('/api/batch/stream', methods=['POST'])
def batch_stream():
    config, err = get_config(request)
    if err:
        return jsonify({'error': err}), 400
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

    session_key = request.remote_addr + '_' + original_name

    def generate():
        processed = []
        total = len(rows)
        for i, row in enumerate(rows, start=1):
            image_url = row.get('链接', '').strip()
            if not image_url:
                item = {**row, 'label': '', 'status': '失败: 链接为空'}
            else:
                try:
                    result = classify_image(image_url, config['api_key'], config['model'], config['base_url'])
                    item = {**row, 'label': result['label'], 'status': '成功'}
                except Exception as e:
                    item = {**row, 'label': '', 'status': f'失败: {str(e)}'}
            processed.append(item)
            yield f"data: {json.dumps({'index': i, 'total': total, 'status': item['status']}, ensure_ascii=False)}\n\n"

        download_name = build_download_name(original_name)
        try:
            out_fd, out_path = tempfile.mkstemp(suffix='.xlsx')
            os.close(out_fd)
            write_results(processed, out_path)
            _batch_results[session_key] = {'path': out_path, 'name': download_name}
        except Exception as e:
            yield f"data: {json.dumps({'done': True, 'error': str(e)}, ensure_ascii=False)}\n\n"
            return
        success = sum(1 for r in processed if r['status'] == '成功')
        yield f"data: {json.dumps({'done': True, 'total': total, 'success': success, 'fail': total - success, 'session_key': session_key, 'download_name': download_name}, ensure_ascii=False)}\n\n"

    return Response(generate(), mimetype='text/event-stream',
                    headers={'X-Accel-Buffering': 'no', 'Cache-Control': 'no-cache'})


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
