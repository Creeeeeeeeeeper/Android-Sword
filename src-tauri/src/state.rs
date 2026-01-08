use std::collections::HashMap;
use std::process::Child;
use std::sync::Mutex;

/// Frida进程输出行
#[derive(serde::Serialize, Clone)]
pub struct FridaOutputLine {
    pub content: String,
    #[serde(rename = "type")]
    pub line_type: String,
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
}

impl AppState {
    pub fn new() -> Self {
        Self {
            scrcpy_processes: Mutex::new(HashMap::new()),
            capture_processes: Mutex::new(HashMap::new()),
            frida_processes: Mutex::new(HashMap::new()),
            frida_outputs: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
