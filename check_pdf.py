import subprocess, sys, json, os

pdf_path = r"C:\Users\Administrator\Desktop\2026年广西省三支一扶考试《综合知识》绝密押题五套卷（三）.pdf"

# 检查文件是否存在和大小
if not os.path.exists(pdf_path):
    print("文件不存在")
    sys.exit(1)

size_mb = os.path.getsize(pdf_path) / (1024 * 1024)
print(f"文件大小: {size_mb:.2f} MB")

# 尝试用pypdf（可能已安装）提取文字
try:
    from pypdf import PdfReader
    reader = PdfReader(pdf_path)
    print(f"总页数: {len(reader.pages)}")
    
    text = ""
    for i, page in enumerate(reader.pages):
        page_text = page.extract_text() or ""
        text += page_text + "\n"
        if i < 3:
            print(f"\n--- 第{i+1}页前200字 ---")
            print(page_text[:200])
    
    print(f"\n提取到的总文字数: {len(text)}")
    if len(text) < 100:
        print("\n⚠️ 警告: 提取到的文字极少，这个PDF很可能是扫描版（图片PDF）！")
        print("扫描版PDF需要用OCR识别，而不是直接提取文字。")
    else:
        print("\n✅ 这是文字层PDF，可以直接提取文字。")
        
except ImportError:
    print("pypdf未安装，尝试用pip安装...")
    subprocess.run([sys.executable, "-m", "pip", "install", "pypdf", "-q"])
    print("已安装，请重新运行脚本")
except Exception as e:
    print(f"解析错误: {e}")
