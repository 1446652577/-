import sys
from pathlib import Path

# 找到 managed python 的 site-packages
runtime = Path(sys.executable).parent.parent.parent
sys.path.insert(0, str(runtime / 'Lib' / 'site-packages'))

try:
    import pdfplumber
    pdf_path = r'C:\Users\Administrator\Desktop\2026年广西省三支一扶考试《综合知识》绝密押题五套卷（三）.pdf'
    with pdfplumber.open(pdf_path) as pdf:
        print(f'总页数: {len(pdf.pages)}')
        for i, page in enumerate(pdf.pages[:3]):
            text = page.extract_text() or ''
            print(f'第{i+1}页文字长度: {len(text)}')
            print(f'前200字: {text[:200]}')
            print('---')
        # 检查是否有图片
        page = pdf.pages[0]
        images = page.images
        print(f'第1页图片数: {len(images)}')
except Exception as e:
    print(f'错误: {e}')
    import traceback
    traceback.print_exc()
