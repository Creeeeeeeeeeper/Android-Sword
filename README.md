# Android Sword

<p align="center">一款开源的apk一体化分析工具</p>

<p align="center"><img src="./README/Androidrobot.png" width="200">

<p align="center">
  <a href="https://www.gnu.org/licenses/gpl-3.0">
    <img src="https://img.shields.io/badge/License-GPLv3-blue.svg" alt="License: GPL v3">
  </a>
  <a href="https://github.com/Creeeeeeeeeeper/Android-Sword/stargazers">
    <img src="https://img.shields.io/github/stars/Creeeeeeeeeeper/Android-Sword?style=social" alt="GitHub stars">
  </a>
  <a href="https://github.com/Creeeeeeeeeeper/Android-Sword/network/members">
    <img src="https://img.shields.io/github/forks/Creeeeeeeeeeper/Android-Sword?style=social" alt="GitHub forks">
  </a>
</p>
<p align="center">License: GNU General Public License v3.0</p>

<p align="center">
  <a href="./LICENSE">完整许可证文本</a>
</p>

### 演示视频：

画质不高，将就着看(\*^▽^\*)



https://github.com/user-attachments/assets/924670bc-db51-48db-86c4-8b651792d01a



***更新说明：未来六个月除了修复现有Bug（请提issue），不会新增更多功能或模块***



**新增：AI源码分析**<sub>需要自己配置api_key</sub>

目前支持：Claude（电脑上须安装Claude Code CLI），Kimi，Deepseek，OpenAI，智谱AI。

Claude和Kimi已测试过，后面几个还没测试（因为没申请api_key）

在`源码分析` -> `JADX源码查看 `中，点击一个代码文件之后，能看到右上角有一个`AI分析`按钮，直接点击后，可以使用`设置`界面配置好的默认AI工具直接分析，有AI分析记录的会在文件名边上显示一个[robot]的emoji。

![image-20260111100952308](./README/image-20260111100952308.png)

如果使用不同ai进行多次分析，则可以点击历史记录查看：

![image-20260111101025135](./README/image-20260111101025135.png)

右键`AI分析`按钮可以切换当前分析的AI工具、切换预设提示词等操作

<img src="./README/image-20260111101118638.png" alt="image-20260111101118638" style="zoom:50%;" />

管理提示词预设：`sources`目录下的源码分析默认使用`default_prompt`，`resources`目录中的默认使用`general_prompt`进行分析，还可以自行添加预设列表，添加预设时请注意让ai使用***markdown***格式回复，以便更好的渲染在前端。

### 各模块总览

**总览：**

![image-20260101220015136](./README/image-20260101220015136.png)

**详细信息：**

![image-20260101220114305](./README/image-20260101220114305.png)

**静态权限：**

![image-20260101220138396](./README/image-20260101220138396.png)

**源码分析：**

![image-20260101220200091](./README/image-20260101220200091.png)

![image-20260101220214985](./README/image-20260101220214985.png)

![image-20260101220225193](./README/image-20260101220225193.png)

![image-20260101220320216](./README/image-20260101220320216.png)

**敏感信息：**

![image-20260101220409861](./README/image-20260101220409861.png)

**第三方服务：**

![image-20260106173550680](./README/image-20260106173550680.png)

**网络抓包(r0capture)**

![image-20260106173636196](./README/image-20260106173636196.png)

**Frida脚本：**

![image-20260106173731302](./README/image-20260106173731302.png)
