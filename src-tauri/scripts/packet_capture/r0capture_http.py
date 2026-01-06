#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
r0capture HTTP Style - 类似抓包软件的输出格式
输出完整的HTTP/HTTPS请求头、请求体和响应
"""

__author__ = "Enhanced for HTTP-style output"
__version__ = "3.0"

import argparse
import os
import platform
import datetime
import signal
import socket
import struct
import time
import sys
import json
import re
from pathlib import Path
from collections import defaultdict

import frida

try:
    if os.name == 'nt':
        import win_inet_pton
except ImportError:
    pass

# ANSI 颜色代码
class Colors:
    RESET = '\033[0m'
    RED = '\033[31m'
    GREEN = '\033[32m'
    YELLOW = '\033[33m'
    BLUE = '\033[34m'
    MAGENTA = '\033[35m'
    CYAN = '\033[36m'
    WHITE = '\033[37m'
    BOLD = '\033[1m'
    DIM = '\033[2m'

# 会话管理
class Session:
    def __init__(self, session_id):
        self.session_id = session_id
        self.request_data = b""
        self.response_data = b""
        self.src_addr = ""
        self.dst_addr = ""
        self.timestamp = time.time()
        self.is_complete = False

sessions = {}
packet_counter = 0

# JSON输出文件（从环境变量获取）
json_output_file = os.environ.get('CAPTURE_OUTPUT_FILE', None)
json_packets = []  # 存储所有数据包

def save_packet_to_json(packet_data):
    """保存数据包到JSON文件"""
    global json_packets
    if json_output_file:
        json_packets.append(packet_data)
        try:
            with open(json_output_file, 'w', encoding='utf-8') as f:
                json.dump(json_packets, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"[!] 保存JSON失败: {e}", file=sys.stderr)

def parse_http_headers(data):
    """解析HTTP头部"""
    try:
        # 尝试解码为文本
        text = data.decode('utf-8', errors='ignore')

        # 分离头部和正文
        if '\r\n\r\n' in text:
            headers_text, body = text.split('\r\n\r\n', 1)
        elif '\n\n' in text:
            headers_text, body = text.split('\n\n', 1)
        else:
            headers_text = text
            body = ""

        # 解析头部行
        lines = headers_text.split('\n')
        first_line = lines[0].strip() if lines else ""

        headers = {}
        for line in lines[1:]:
            if ':' in line:
                key, value = line.split(':', 1)
                headers[key.strip()] = value.strip()

        return first_line, headers, body
    except:
        return "", {}, ""

def format_json_body(body):
    """格式化JSON正文"""
    try:
        # 尝试解析为JSON
        json_obj = json.loads(body)
        return json.dumps(json_obj, indent=2, ensure_ascii=False)
    except:
        return body

def detect_content_type(data):
    """检测内容类型"""
    if not data:
        return "unknown"

    # 检查HTTP方法
    http_methods = [b'GET ', b'POST', b'PUT ', b'HEAD', b'DELE', b'PATC', b'OPTI']
    for method in http_methods:
        if data[:4] == method:
            return "request"

    # 检查HTTP响应
    if data[:4] == b'HTTP':
        return "response"

    # 检查是否为二进制数据
    try:
        data.decode('utf-8')
        return "text"
    except:
        return "binary"

def print_http_request(src, dst, data, session_id=""):
    """打印HTTP请求"""
    global packet_counter
    packet_counter += 1

    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]

    print(f"\n{Colors.BOLD}{Colors.GREEN}═══════════════════════════════════════════════════════════════════{Colors.RESET}")
    print(f"{Colors.BOLD}[#{packet_counter}] REQUEST  {timestamp}{Colors.RESET}")
    print(f"{Colors.CYAN}From: {src} → To: {dst}{Colors.RESET}")
    if session_id:
        print(f"{Colors.DIM}Session: {session_id}{Colors.RESET}")
    print(f"{Colors.GREEN}───────────────────────────────────────────────────────────────────{Colors.RESET}")

    first_line, headers, body = parse_http_headers(data)

    if first_line:
        # 请求行
        print(f"{Colors.BOLD}{first_line}{Colors.RESET}")

        # 请求头
        if headers:
            print(f"\n{Colors.YELLOW}Headers:{Colors.RESET}")
            for key, value in headers.items():
                print(f"  {key}: {value}")

        # 请求体
        if body.strip():
            print(f"\n{Colors.YELLOW}Body:{Colors.RESET}")
            # 检查Content-Type
            content_type = headers.get('Content-Type', '').lower()
            if 'json' in content_type:
                formatted_body = format_json_body(body)
                for line in formatted_body.split('\n'):
                    print(f"  {line}")
            elif 'form' in content_type:
                # URL编码的表单数据
                params = body.split('&')
                for param in params:
                    if '=' in param:
                        key, value = param.split('=', 1)
                        print(f"  {key} = {value}")
                    else:
                        print(f"  {param}")
            else:
                # 普通文本或其他
                for line in body.split('\n'):
                    if line.strip():
                        print(f"  {line.strip()}")
    else:
        # 非HTTP格式，显示原始数据
        try:
            text = data.decode('utf-8', errors='ignore')
            if text.isprintable() or '\n' in text:
                for line in text.split('\n'):
                    if line.strip():
                        print(f"  {line.strip()}")
            else:
                # 二进制数据，显示十六进制
                print(f"{Colors.YELLOW}Binary Data ({len(data)} bytes):{Colors.RESET}")
                hex_str = data[:100].hex()
                for i in range(0, len(hex_str), 32):
                    print(f"  {hex_str[i:i+32]}")
                if len(data) > 100:
                    print(f"  ... ({len(data) - 100} more bytes)")
        except:
            print(f"  [Binary data: {len(data)} bytes]")

    # 保存到JSON
    # 解析请求行获取method和path
    method = "UNKNOWN"
    path = "/"
    host = headers.get('Host', '')
    if first_line:
        parts = first_line.split(' ')
        if len(parts) >= 2:
            method = parts[0]
            path = parts[1]

    packet_json = {
        "id": packet_counter,
        "type": "request",
        "time": timestamp,
        "method": method,
        "host": host,
        "path": path,
        "src": src,
        "dst": dst,
        "session_id": session_id,
        "status": None,
        "size": len(data),
        "requestHeaders": headers,
        "requestBody": body[:10000] if body else "",  # 限制大小
        "responseHeaders": None,
        "responseBody": None
    }
    save_packet_to_json(packet_json)

def print_http_response(src, dst, data, session_id=""):
    """打印HTTP响应"""
    global packet_counter
    packet_counter += 1

    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]

    print(f"\n{Colors.BOLD}{Colors.BLUE}═══════════════════════════════════════════════════════════════════{Colors.RESET}")
    print(f"{Colors.BOLD}[#{packet_counter}] RESPONSE {timestamp}{Colors.RESET}")
    print(f"{Colors.CYAN}From: {src} → To: {dst}{Colors.RESET}")
    if session_id:
        print(f"{Colors.DIM}Session: {session_id}{Colors.RESET}")
    print(f"{Colors.BLUE}───────────────────────────────────────────────────────────────────{Colors.RESET}")

    first_line, headers, body = parse_http_headers(data)

    # 解析状态码
    status_code = 0
    status_text = ""
    if first_line:
        # 状态行
        print(f"{Colors.BOLD}{first_line}{Colors.RESET}")

        # 解析状态码 (例如 "HTTP/1.1 200 OK")
        parts = first_line.split(' ', 2)
        if len(parts) >= 2:
            try:
                status_code = int(parts[1])
                status_text = parts[2] if len(parts) > 2 else ""
            except:
                pass

        # 响应头
        if headers:
            print(f"\n{Colors.YELLOW}Headers:{Colors.RESET}")
            for key, value in headers.items():
                print(f"  {key}: {value}")

        # 响应体
        if body.strip():
            print(f"\n{Colors.YELLOW}Body:{Colors.RESET}")
            # 检查Content-Type
            content_type = headers.get('Content-Type', '').lower()
            if 'json' in content_type:
                formatted_body = format_json_body(body)
                for line in formatted_body.split('\n'):
                    print(f"  {line}")
            elif 'html' in content_type:
                # HTML内容，只显示前面部分
                lines = body.split('\n')[:10]
                for line in lines:
                    if line.strip():
                        print(f"  {line.strip()[:100]}")
                if len(body.split('\n')) > 10:
                    print(f"  ... (HTML content truncated)")
            elif 'xml' in content_type:
                # XML内容
                lines = body.split('\n')[:20]
                for line in lines:
                    if line.strip():
                        print(f"  {line.strip()}")
                if len(body.split('\n')) > 20:
                    print(f"  ... (XML content truncated)")
            else:
                # 其他文本
                lines = body.split('\n')
                for i, line in enumerate(lines[:50]):
                    if line.strip():
                        print(f"  {line.strip()[:200]}")
                if len(lines) > 50:
                    print(f"  ... ({len(lines) - 50} more lines)")
    else:
        # 非HTTP格式
        try:
            text = data.decode('utf-8', errors='ignore')
            if text.isprintable() or '\n' in text:
                lines = text.split('\n')
                for line in lines[:20]:
                    if line.strip():
                        print(f"  {line.strip()[:200]}")
                if len(lines) > 20:
                    print(f"  ... ({len(lines) - 20} more lines)")
            else:
                # 二进制数据
                print(f"{Colors.YELLOW}Binary Data ({len(data)} bytes):{Colors.RESET}")
                hex_str = data[:100].hex()
                for i in range(0, len(hex_str), 32):
                    print(f"  {hex_str[i:i+32]}")
                if len(data) > 100:
                    print(f"  ... ({len(data) - 100} more bytes)")
        except:
            print(f"  [Binary data: {len(data)} bytes]")

    # 保存到JSON
    packet_json = {
        "id": packet_counter,
        "type": "response",
        "time": timestamp,
        "method": None,
        "host": headers.get('Server', ''),
        "path": None,
        "src": src,
        "dst": dst,
        "session_id": session_id,
        "status": status_code,
        "statusText": status_text,
        "size": len(data),
        "requestHeaders": None,
        "requestBody": None,
        "responseHeaders": headers,
        "responseBody": body[:10000] if body else ""  # 限制大小
    }
    save_packet_to_json(packet_json)

class HTTPCapture:
    def __init__(self, process, pcap=None, host=None, verbose=True, isUsb=False,
                 ssllib="", isSpawn=True, wait=0, isEmulator=False):
        self.process = process
        self.pcap = pcap
        self.host = host
        self.verbose = verbose
        self.isUsb = isUsb
        self.ssllib = ssllib
        self.isSpawn = isSpawn
        self.wait = wait
        self.isEmulator = isEmulator
        self.pcap_file = None
        self.session = None
        self.device = None
        self.sessions = {}

    def connect_device(self):
        """连接设备，支持真机、模拟器和远程设备"""
        try:
            if self.isEmulator:
                print(f"{Colors.YELLOW}[*] 正在连接模拟器...{Colors.RESET}")
                try:
                    # 尝试连接常见的Android模拟器端口
                    manager = frida.get_device_manager()
                    emulator_ports = [
                        '127.0.0.1:5555',  # 默认ADB端口
                        '127.0.0.1:5554',  # 备用端口
                        '127.0.0.1:62001', # 夜神模拟器
                        '127.0.0.1:21503', # 逍遥模拟器
                        '127.0.0.1:7555',  # MuMu模拟器
                        '127.0.0.1:5037',  # ADB服务端口
                    ]

                    connected = False
                    for port in emulator_ports:
                        try:
                            print(f"  尝试连接 {port}...")
                            self.device = manager.add_remote_device(port)
                            print(f"{Colors.GREEN}[+] 成功连接到模拟器: {port}{Colors.RESET}")
                            connected = True
                            break
                        except:
                            continue

                    if not connected:
                        print(f"{Colors.YELLOW}  尝试USB设备...{Colors.RESET}")
                        try:
                            self.device = frida.get_usb_device()
                            print(f"{Colors.GREEN}[+] 通过USB连接成功{Colors.RESET}")
                        except:
                            self.device = frida.get_remote_device()
                            print(f"{Colors.GREEN}[+] 通过远程连接成功{Colors.RESET}")

                except Exception as e:
                    print(f"{Colors.RED}[-] 模拟器连接失败: {e}{Colors.RESET}")
                    raise

            elif self.isUsb:
                print(f"{Colors.YELLOW}[*] 正在连接USB设备...{Colors.RESET}")
                try:
                    self.device = frida.get_usb_device()
                    print(f"{Colors.GREEN}[+] USB设备连接成功{Colors.RESET}")
                except:
                    self.device = frida.get_remote_device()
                    print(f"{Colors.GREEN}[+] 远程设备连接成功{Colors.RESET}")

            elif self.host:
                print(f"{Colors.YELLOW}[*] 正在连接到 {self.host}...{Colors.RESET}")
                manager = frida.get_device_manager()
                self.device = manager.add_remote_device(self.host)
                print(f"{Colors.GREEN}[+] 远程连接成功: {self.host}{Colors.RESET}")

            else:
                print(f"{Colors.YELLOW}[*] 正在连接本地设备...{Colors.RESET}")
                self.device = frida.get_local_device()
                print(f"{Colors.GREEN}[+] 本地设备连接成功{Colors.RESET}")

        except Exception as e:
            print(f"{Colors.RED}[-] 设备连接错误: {e}{Colors.RESET}")
            raise

    def attach_process(self):
        """附加到进程"""
        try:
            if self.isSpawn:
                print(f"{Colors.YELLOW}[*] 正在启动 {self.process}...{Colors.RESET}")
                pid = self.device.spawn([self.process])
                time.sleep(1)
                self.session = self.device.attach(pid)
                time.sleep(1)
                self.device.resume(pid)
                print(f"{Colors.GREEN}[+] 进程已启动并附加 (PID: {pid}){Colors.RESET}")
            else:
                print(f"{Colors.YELLOW}[*] 正在附加到 {self.process}...{Colors.RESET}")
                self.session = self.device.attach(self.process)
                print(f"{Colors.GREEN}[+] 已附加到进程{Colors.RESET}")

            if self.wait > 0:
                print(f"{Colors.YELLOW}[*] 等待 {self.wait} 秒...{Colors.RESET}")
                time.sleep(self.wait)

        except Exception as e:
            print(f"{Colors.RED}[-] 进程附加错误: {e}{Colors.RESET}")
            raise

    def init_pcap(self):
        """初始化PCAP文件"""
        if self.pcap:
            self.pcap_file = open(self.pcap, "wb", 0)
            # PCAP文件头
            for writes in (
                    ("=I", 0xa1b2c3d4),  # Magic number
                    ("=H", 2),  # Major version number
                    ("=H", 4),  # Minor version number
                    ("=i", time.timezone),  # GMT to local correction
                    ("=I", 0),  # Accuracy of timestamps
                    ("=I", 65535),  # Max length of captured packets
                    ("=I", 228)):  # Data link type (LINKTYPE_IPV4)
                self.pcap_file.write(struct.pack(writes[0], writes[1]))
            print(f"{Colors.GREEN}[+] PCAP文件已创建: {self.pcap}{Colors.RESET}")

    def log_pcap(self, ssl_session_id, function, src_addr, src_port,
                 dst_addr, dst_port, data):
        """写入PCAP数据"""
        if not self.pcap_file:
            return

        t = time.time()

        # 简化的PCAP写入
        for writes in (
                ("=I", int(t)),
                ("=I", int((t * 1000000) % 1000000)),
                ("=I", 40 + len(data)),
                ("=i", 40 + len(data)),
                (">B", 0x45),
                (">B", 0),
                (">H", 40 + len(data)),
                (">H", 0),
                (">H", 0x4000),
                (">B", 0xFF),
                (">B", 6),
                (">H", 0),
                (">I", src_addr),
                (">I", dst_addr),
                (">H", src_port),
                (">H", dst_port),
                (">I", 0),
                (">I", 0),
                (">H", 0x5018),
                (">H", 0xFFFF),
                (">H", 0),
                (">H", 0)):
            self.pcap_file.write(struct.pack(writes[0], writes[1]))
        self.pcap_file.write(data)

    def on_message(self, message, data):
        """处理Frida消息"""
        if message["type"] == "error":
            print(f"{Colors.RED}[!] 错误: {message}{Colors.RESET}")
            return

        if len(data) <= 1:
            # 非数据消息
            if "payload" in message:
                p = message["payload"]
                if "function" in p and p["function"].startswith("dump"):
                    print(f"{Colors.MAGENTA}[*] {p['function']}{Colors.RESET}")
            return

        p = message["payload"]

        # 解析地址
        try:
            src_addr_str = socket.inet_ntop(socket.AF_INET, struct.pack(">I", p["src_addr"]))
            dst_addr_str = socket.inet_ntop(socket.AF_INET, struct.pack(">I", p["dst_addr"]))
        except:
            src_addr_str = "0.0.0.0"
            dst_addr_str = "0.0.0.0"

        src = f"{src_addr_str}:{p['src_port']}"
        dst = f"{dst_addr_str}:{p['dst_port']}"

        # 获取session_id
        session_id = p.get("ssl_session_id", "")

        # 判断是请求还是响应
        if p["function"] in ["SSL_write", "HTTP_send"]:
            # 请求
            print_http_request(src, dst, data, session_id)
        else:
            # 响应
            print_http_response(src, dst, data, session_id)

        # 保存到PCAP
        if self.pcap:
            self.log_pcap(session_id, p["function"],
                         p["src_addr"], p["src_port"],
                         p["dst_addr"], p["dst_port"], data)

    def load_script(self):
        """加载Frida脚本"""
        # 尝试多个可能的路径
        possible_paths = [
            Path(__file__).resolve().parent.joinpath("script.js"),
            # Path("/mnt/d/Desktop/claude/script.js"),
            # Path("/mnt/d/Desktop/逆向/r0capture/script.js"),
            Path("./script.js"),
            # Path("script.js")
        ]

        script_path = None
        for path in possible_paths:
            if path.exists():
                script_path = path
                print(f"{Colors.GREEN}[+] 找到脚本: {script_path}{Colors.RESET}")
                break

        if script_path is None:
            print(f"{Colors.RED}[-] 未找到script.js，尝试复制...{Colors.RESET}")
            # 尝试从原始路径复制
            src_path = Path("/mnt/d/Desktop/逆向/r0capture/script.js")
            dst_path = Path(__file__).resolve().parent.joinpath("script.js")
            if src_path.exists():
                import shutil
                shutil.copy(str(src_path), str(dst_path))
                script_path = dst_path
                print(f"{Colors.GREEN}[+] 已复制script.js到当前目录{Colors.RESET}")
            else:
                raise FileNotFoundError("无法找到script.js文件")

        with open(script_path, encoding="utf-8") as f:
            script_content = f.read()

        self.script = self.session.create_script(script_content)
        self.script.on("message", self.on_message)
        self.script.load()

        if self.ssllib:
            self.script.exports.setssllib(self.ssllib)
            print(f"{Colors.GREEN}[+] SSL库已设置: {self.ssllib}{Colors.RESET}")

    def start(self):
        """开始抓包"""
        try:
            # 连接设备
            self.connect_device()

            # 附加进程
            self.attach_process()

            # 初始化PCAP
            self.init_pcap()

            # 加载脚本
            self.load_script()

            print(f"\n{Colors.GREEN}[+] 开始抓包，按 Ctrl+C 停止{Colors.RESET}")
            print(f"{Colors.DIM}提示: 显示HTTP/HTTPS请求和响应的完整内容{Colors.RESET}\n")

            # 处理中断信号
            def stop_capture(signum, frame):
                print(f"\n{Colors.YELLOW}[*] 正在停止抓包...{Colors.RESET}")
                if self.session:
                    self.session.detach()
                if self.pcap_file:
                    self.pcap_file.flush()
                    self.pcap_file.close()
                    print(f"{Colors.GREEN}[+] PCAP已保存到: {self.pcap}{Colors.RESET}")
                print(f"{Colors.GREEN}[+] 共抓取数据包: {packet_counter}{Colors.RESET}")
                sys.exit(0)

            signal.signal(signal.SIGINT, stop_capture)
            signal.signal(signal.SIGTERM, stop_capture)
            sys.stdin.read()

        except Exception as e:
            print(f"{Colors.RED}[!] 错误: {e}{Colors.RESET}")
            if self.session:
                self.session.detach()
            if self.pcap_file:
                self.pcap_file.close()
            sys.exit(1)

def show_banner():
    """显示横幅"""
    banner = f"""
{Colors.CYAN}╔═══════════════════════════════════════════════════════════════════╗
║     r0capture HTTP Style - SSL/TLS Traffic Capture Tool          ║
║              Version {__version__} - HTTP/HTTPS 抓包格式                  ║
╚═══════════════════════════════════════════════════════════════════╝{Colors.RESET}
"""
    print(banner)

def main():
    show_banner()

    parser = argparse.ArgumentParser(
        description="r0capture HTTP Style - 类似抓包软件的输出格式",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
    %(prog)s com.example.app                    # 基础抓包
    %(prog)s -U -f com.example.app              # USB设备，spawn模式
    %(prog)s -E -f com.example.app              # 模拟器，spawn模式
    %(prog)s -p capture.pcap com.example.app    # 保存到PCAP
    %(prog)s -H 192.168.1.100:27042 1234        # 远程设备
        """)

    parser.add_argument("process",
                       help="进程名或PID")
    parser.add_argument("-p", "--pcap", metavar="<path>",
                       help="保存到PCAP文件")
    parser.add_argument("-H", "--host", metavar="<host:port>",
                       help="连接到远程frida-server")
    parser.add_argument("-v", "--verbose", action="store_true", default=True,
                       help="详细输出 (默认: True)")
    parser.add_argument("-U", "--usb", action="store_true",
                       help="连接USB设备")
    parser.add_argument("-E", "--emulator", action="store_true",
                       help="连接Android模拟器")
    parser.add_argument("-f", "--spawn", action="store_true",
                       help="Spawn模式启动进程")
    parser.add_argument("-w", "--wait", type=int, default=0,
                       help="附加后等待N秒")
    parser.add_argument("--ssl", default="", metavar="<lib>",
                       help="指定SSL库")

    args = parser.parse_args()

    # 处理进程参数
    process = int(args.process) if args.process.isdigit() else args.process

    # 创建抓包实例
    capture = HTTPCapture(
        process=process,
        pcap=args.pcap,
        host=args.host,
        verbose=args.verbose,
        isUsb=args.usb,
        isEmulator=args.emulator,
        ssllib=args.ssl,
        isSpawn=args.spawn,
        wait=args.wait
    )

    # 开始抓包
    capture.start()

if __name__ == "__main__":
    main()