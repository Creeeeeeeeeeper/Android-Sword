use std::collections::HashMap;
use std::process::Child;
use std::sync::{Arc, Mutex};

/// Frida进程输出行
#[derive(serde::Serialize, Clone)]
pub struct FridaOutputLine {
    pub content: String,
    #[serde(rename = "type")]
    pub line_type: String,
}

/// 网络数据包结构
#[derive(serde::Serialize, Clone, Debug)]
pub struct NetworkPacket {
    pub id: u64,
    pub timestamp: String,
    pub time: String,
    pub protocol: String,        // TCP, UDP, DNS, HTTP, HTTPS, ICMP 等
    pub src_addr: String,        // 源地址
    pub src_port: u16,           // 源端口
    pub dst_addr: String,        // 目的地址
    pub dst_port: u16,           // 目的端口
    pub direction: String,       // in/out/unknown
    pub length: u32,             // 数据长度
    pub info: String,            // 额外信息（如 DNS 查询、HTTP 方法等）
    pub flags: String,           // TCP 标志位
    pub raw: String,             // 原始输出
    pub hex_dump: String,        // 十六进制数据
    pub ascii_dump: String,      // ASCII 解码数据
    pub payload: String,         // 原始payload（可解码的部分）
}

/// 实时抓包缓冲区
pub struct TcpdumpBuffer {
    pub packets: Vec<NetworkPacket>,
    pub running: bool,
    pub packet_counter: u64,
}

/// Frida进程输出缓冲结构
pub struct FridaOutputBuffer {
    pub lines: Vec<FridaOutputLine>,
    pub finished: bool,
}

/// 应用状态结构体
pub struct AppState {
    pub scrcpy_processes: Mutex<HashMap<String, Child>>,
    pub capture_processes: Mutex<HashMap<String, Child>>,
    pub frida_processes: Mutex<HashMap<String, Child>>,
    pub frida_outputs: Mutex<HashMap<String, FridaOutputBuffer>>,
    pub tcpdump_buffers: Arc<Mutex<HashMap<String, TcpdumpBuffer>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            scrcpy_processes: Mutex::new(HashMap::new()),
            capture_processes: Mutex::new(HashMap::new()),
            frida_processes: Mutex::new(HashMap::new()),
            frida_outputs: Mutex::new(HashMap::new()),
            tcpdump_buffers: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
