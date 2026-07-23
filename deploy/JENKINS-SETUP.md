# Jenkins Job 逐步配置清单（art_data）

按顺序点完即可。总览与变量表见 [CI-CD.md](./CI-CD.md)。

前置：Jenkins 可访问 GitHub 仓库 `bei123/art_data`，至少有一台 **Linux** agent（含 `git`、`rsync`、`openssh-client`、`tar`、`zip`）。

> **Nodes vs NodeJS**  
>
> - **Nodes（节点 / Agent）**：跑 Job 的机器 → 见下方 **「Nodes（Agent）怎么配」**  
> - **NodeJS 工具 `node-24`**：Jenkins 全局工具里的 Node 版本 → 见 **§1**

---

## Nodes（Agent）怎么配

Pipeline 里是 `agent any`，只要有一台在线 Linux 节点就能跑。两种常见做法：


| 方案                  | 适用         | 说明                   |
| ------------------- | ---------- | -------------------- |
| A. 只用 Built-in Node | 单机试验 / 小团队 | Job 跑在 Jenkins 控制器本机 |
| B. 单独 SSH Agent（推荐） | 生产         | 构建/rsync 与 Master 分离 |


### A. 只用 Built-in（最快）

1. **Manage Jenkins → Nodes**
2. 点 **Built-In Node** → **Configure**
3. 建议：
  - **Number of executors**：`2`（按 CPU 调）
  - **Labels**：加 `linux`（可选）
  - **Usage**：`Use this node as much as possible`
4. **Save**
5. 在 Built-in 机器上装好依赖（见下方「Agent 机器软件」）

> 若 Master 是 Windows，**不要**用 Built-in 跑本仓库 Deploy（脚本是 bash/`rsync`）。请用方案 B 一台 Linux。

### B. 新增 Linux Agent（SSH）

#### B1. 准备 Agent 机器

在 **Linux** 机上执行（Ubuntu/Debian 示例）：

```bash
# 用户（建议独立账号，勿强求 root）
sudo useradd -m -s /bin/bash jenkins
sudo mkdir -p /home/jenkins/agent
sudo chown -R jenkins:jenkins /home/jenkins

# 依赖
sudo apt-get update
sudo apt-get install -y openjdk-17-jre-headless git openssh-client openssh-server rsync tar zip curl

# Node 可不手装：Jenkins NodeJS 插件会按 tool「node-24」自动装到 agent
# 若想本机已有 node：curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs
```

#### B2. SSH 免密（Master → Agent）

在 **Jenkins 控制器**上（或你本机生成后导入 Credentials）：

```bash
ssh-keygen -t ed25519 -C "jenkins-agent" -f jenkins_agent_key -N ""
# 把 jenkins_agent_key.pub 内容追加到 Agent：
#   /home/jenkins/.ssh/authorized_keys
# 权限：.ssh=700，authorized_keys=600，属主 jenkins
```

从 Master 测通：

```bash
ssh -i jenkins_agent_key jenkins@<AGENT_IP>
```

#### B3. Jenkins 里加「连 Agent 的」凭证

**Manage Jenkins → Credentials → Global → Add Credentials**


| 字段          | 值                                          |
| ----------- | ------------------------------------------ |
| Kind        | SSH Username with private key              |
| ID          | `jenkins-agent-ssh`（自定即可）                  |
| Username    | `jenkins`                                  |
| Private Key | Enter directly → 粘贴 `jenkins_agent_key` 私钥 |


> 这和部署生产机的 `art-data-ssh` **不是同一个**：  
>
> - `jenkins-agent-ssh`：Jenkins Master → **构建 Agent**  
> - `art-data-ssh`：Agent 上 Job → **宝塔生产机**

#### B4. 在 UI 里 New Node

1. **Manage Jenkins → Nodes → New Node**
2. **Node name**：如 `art-data-linux`
3. 类型：**Permanent Agent** → **Create**
4. 填写：


| 字段                             | 建议值                                        |
| ------------------------------ | ------------------------------------------ |
| Description                    | art_data CI/CD agent                       |
| Number of executors            | `2`                                        |
| Remote root directory          | `/home/jenkins/agent`                      |
| Labels                         | `linux art-data`（空格分隔）                     |
| Usage                          | Use this node as much as possible          |
| Launch method                  | **Launch agents via SSH**                  |
| Host                           | Agent IP 或域名                               |
| Credentials                    | 选上一步的 `jenkins-agent-ssh`                  |
| Host Key Verification Strategy | **Known hosts file**（稳）或临时用 Non verifying  |
| Availability                   | Keep this agent online as much as possible |


1. **Save**
2. 进入该 Node → 看状态应为 **Connected** / 绿；若离线点 **Relaunch agent**，再点 **Log** 看报错

#### B5.（可选）让 Job 固定跑这台

当前 Pipeline 是 `agent any`。若只要这台 Linux：

- 临时：Node **Usage** 设为 only build jobs with label，Job 里改 `agent { label 'linux' }`  
- 或保持 `agent any`，关掉 Built-in 的 executors（设为 `0`），只留 Linux Agent

### Agent 机器软件检查

在 Agent 上执行，都应成功：

```bash
java -version          # 17+
git --version
rsync --version
ssh -V
tar --version
zip -v | head -1
```

Deploy Job 还会从这台机 **SSH/rsync 到宝塔**，所以 Agent 出口 IP 要能访问生产机 **22**（安全组放行）。

### Node 常见报错


| 现象                                      | 处理                                   |
| --------------------------------------- | ------------------------------------ |
| Agent offline / SSH timeout             | 安全组、sshd、IP、端口 22                    |
| `Permission denied (publickey)`         | 公钥未进 `authorized_keys` / Username 不对 |
| `Remote root directory is not writable` | 目录属主改为 `jenkins`，权限可写                |
| 只有 Built-in、Job 卡在 Windows              | 加 Linux Agent，Built-in executors 设 0 |
| `No tool named node-24`                 | 回 §1 配 NodeJS 工具（与 Node 节点无关）        |


---

## 0. 安装插件

**Manage Jenkins → Plugins → Available plugins**，搜索并安装（已装可跳过）：

- [ ] Pipeline
- [ ] Pipeline: Stage View（可选）
- [ ] NodeJS
- [ ] Credentials Binding
- [ ] SSH Credentials
- [ ] Git
- [ ] GitHub（或 Generic Webhook Trigger）
- [ ] Multibranch Scan Webhook Trigger（可选，CI 用）

安装后按提示 **Restart Jenkins**（如需要）。

---

## 1. 配置 NodeJS 工具（必须叫 `node-24`）

1. **Manage Jenkins → Tools**
2. 找到 **NodeJS installations** → **Add NodeJS**
3. 填写：
  - **Name**：`node-24`（必须完全一致，Pipeline 里写死了）
  - **Version**：Node.js 24.x（勾选 Install automatically，或指向本机已装路径）
4. **Save**

---

## 2. 添加 Credentials

路径：**Manage Jenkins → Credentials → System → Global credentials → Add Credentials**  
（也可用 Folder 级凭证，但 ID 必须一致。）

按下面逐条添加，**ID 不要改**：

### 2.1 部署 SSH（必填）


| 字段          | 值                                                                |
| ----------- | ---------------------------------------------------------------- |
| Kind        | **SSH Username with private key**                                |
| ID          | `art-data-ssh`                                                   |
| Username    | `root`（或服务器实际部署用户）                                               |
| Private Key | Enter directly → 粘贴私钥（`deploy/server-init.sh` 生成的或现有 deploy key） |
| Passphrase  | 无则空                                                              |


服务器上公钥须已在 `~/.ssh/authorized_keys`。

### 2.2 SSH 主机（必填）

意思：告诉 Deploy「要连哪台**生产机**」。  
只存一个字符串（IP 或域名），**不是**私钥，也**不是** Agent `192.168.0.61`。

| 字段 | 填什么 |
|------|--------|
| Kind | **Secret text**（纯文本密码/密钥类；这里用来存 IP） |
| ID | `art-data-ssh-host`（必须一字不差） |
| Secret | **宝塔生产机**的公网 IP 或域名，例如 `47.x.x.x` |

点击路径：

1. **Manage Jenkins → Credentials → System → Global credentials → Add Credentials**
2. Kind 下拉选 **Secret text**
3. **Secret** 框里只写 IP，例如：`47.98.xxx.xxx`（不要 `http://`，不要端口）
4. **ID** 填：`art-data-ssh-host`
5. Description 可写：`art_data 生产机 IP`
6. **Create**

和 2.1 的分工：

```text
2.1 art-data-ssh       → 用谁的身份登录（用户名 + 私钥）
2.2 art-data-ssh-host  → 登录哪台机器（IP）
```

两把钥匙别和 Agent 搞混：

| 配置 | 连谁 |
|------|------|
| Node 里的 Host `192.168.0.61` + `jenkins-agent-ssh` | Jenkins Master → **构建 Agent** |
| `art-data-ssh-host` + `art-data-ssh` | Agent 上跑 Deploy → **宝塔生产机** |

若生产机就是内网某台，Secret 就填那台能从 Agent 访问到的 IP（例如 Agent 能 `ssh root@该IP` 通的那个）。
### 2.3 GitHub Packages Token（必填）

意思：CI / Deploy 跑 `npm ci` 时，要能从 **GitHub Packages** 下载私有包 `@bei123/*`。  
仓库里的 `.npmrc` 写了：有环境变量 `NODE_AUTH_TOKEN` 才装得上这些包。

| 字段 | 填什么 |
|------|--------|
| Kind | **Secret text** |
| ID | `art-data-node-auth-token`（必须一字不差） |
| Secret | 一个 GitHub **Personal Access Token（PAT）** 字符串 |

#### 怎么生成这个 Token

1. 浏览器打开 GitHub（能读 `bei123` 组织/仓库 Packages 的账号）
2. 右上角头像 → **Settings** → 左侧最下面 **Developer settings**
3. **Personal access tokens → Tokens (classic) → Generate new token (classic)**
4. Note 随便写：`jenkins-art-data-npm`
5. Expiration：按公司要求选（如 90 days）
6. 勾选权限（至少）：
   - [x] **`read:packages`**（读 GitHub Packages，必需）
   - 若仓库/包在私有组织里，有时还要账号已加入该 org，或额外 `repo`（按你们包的可见性）
7. **Generate token** → **立刻复制**（只显示一次），形如 `ghp_xxxxxxxxxxxx`

#### 在 Jenkins 里怎么填

1. **Add Credentials**
2. Kind：**Secret text**
3. **Secret**：粘贴刚才的 `ghp_...`（整段，前后不要空格）
4. **ID**：`art-data-node-auth-token`
5. Description：`npm 读 @bei123 GitHub Packages`
6. **Create**

Pipeline 会把它注成环境变量 `NODE_AUTH_TOKEN`，对应：

```text
.npmrc → //npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

#### 和别的凭证别混

| ID | 干什么 |
|----|--------|
| `art-data-node-auth-token`（2.3） | `npm ci` 下载 `@bei123/*` |
| `art-data-git`（2.7） | Jenkins **clone 仓库代码** |
| `art-data-github-token`（2.6，可选） | `gh release` 发版，可另建；不要和 2.3 强行共用，除非权限都够 |

本地若已经能 `npm ci`，多半本机也配过同类 PAT；Jenkins 需要**再存一份**到 Credentials。
### 2.4 管理台签名密钥（必填）


| 字段     | 值                                                |
| ------ | ------------------------------------------------ |
| Kind   | **Secret text**                                  |
| ID     | `art-data-vite-api-sign-secret`                  |
| Secret | 与服务器 `.env` 里 `API_SIGN_SECRET_ADMIN_WEB` **相同** |


### 2.5 宝塔 API（可选，缺省则 Deploy 里 Nginx reload 变 UNSTABLE）


| ID                      | Kind        | Secret                   |
| ----------------------- | ----------- | ------------------------ |
| `art-data-bt-panel-url` | Secret text | 如 `https://x.x.x.x:8888` |
| `art-data-bt-api-key`   | Secret text | 宝塔 API 密钥                |


### 2.6 GitHub Release（可选）


| ID                      | Kind        | Secret                      |
| ----------------------- | ----------- | --------------------------- |
| `art-data-github-token` | Secret text | `repo` 权限 PAT（`gh release`） |


### 2.7 拉代码用的 Git 凭证（私有仓必填）

意思：Jenkins Job 要从 GitHub **把 `art_data` 仓库 clone 下来**。私有仓必须带登录凭证，否则 checkout 报 `Authentication failed` / `Repository not found`。

推荐用 **方式 A（HTTPS + PAT）**，和 2.3 同类，最好懂。

---

#### 方式 A：HTTPS + Username/Password（推荐）

仓库 URL 后面用：`https://github.com/bei123/art_data.git`

**① 生成（或复用）有 `repo` 权限的 PAT**

1. GitHub → **Settings → Developer settings → Personal access tokens (classic) → Generate new token**
2. Note：`jenkins-art-data-git`
3. 勾选：
   - [x] **`repo`**（私有仓读写/clone 需要；只读也可勾整个 repo）
4. Generate → 复制 `ghp_...`

> 和 2.3 的区别：2.3 至少要 `read:packages`；2.7 至少要 `repo`。  
> 可以建**两个** PAT，也可以建**一个**同时勾选 `repo` + `read:packages`，但 Jenkins 里仍建议分成两个 Credential（职责清晰）。若偷懒：同一个 `ghp_...` 填进 2.3 和 2.7 两处也可以（权限都勾上）。

**② 在 Jenkins 添加 Credential**

1. **Manage Jenkins → Credentials → Global → Add Credentials**
2. 填写：

| 字段 | 填什么 |
|------|--------|
| Kind | **Username with password** |
| Username | 你的 **GitHub 用户名**（不是邮箱；例如 `bei123`） |
| Password | 粘贴 PAT `ghp_...`（**不要**填登录密码） |
| ID | `art-data-git` |
| Description | `clone art_data 仓库` |

3. **Create**

**③ 后面建 Job 时怎么用**

- Repository URL：`https://github.com/bei123/art_data.git`
- Credentials：下拉选 **`art-data-git`**

---

#### 方式 B：SSH 私钥（可选）

仓库 URL 用：`git@github.com:bei123/art_data.git`

1. 生成专用 key（PEM，避免又踩 Agent 那种格式坑）：

```bash
ssh-keygen -t rsa -b 4096 -m PEM -C "jenkins-art-data-git" -f jenkins_git_key -N ""
```

2. GitHub 仓库 → **Settings → Deploy keys → Add deploy key**
   - Title：`jenkins-read`
   - Key：粘贴 `jenkins_git_key.pub` 全文
   - 只读即可（不勾 Allow write，除非要 push）

3. Jenkins → Add Credentials：

| 字段 | 填什么 |
|------|--------|
| Kind | **SSH Username with private key** |
| ID | `art-data-git` |
| Username | `git`（GitHub SSH 固定用 `git`，不是你的用户名） |
| Private Key | Enter directly → 粘贴 `jenkins_git_key` 私钥全文 |

4. Job 里 Repository URL 填 `git@github.com:bei123/art_data.git`，Credentials 选 `art-data-git`。

---

#### 和 2.1 / Agent 钥的区别

| 凭证 | 连谁 | 干什么 |
|------|------|--------|
| `art-data-git`（2.7） | GitHub | **拉代码** |
| `jenkins-agent-ssh` | `192.168.0.61` | Master 登录构建机 |
| `art-data-ssh`（2.1） | 宝塔生产机 | 部署 rsync / git sync |

公有仓库可以不配 2.7；你们是私有仓，**必须配**。
---

## 3.（推荐）建 Folder 并挂环境变量

1. **New Item** → 名称 `art_data` → 选 **Folder** → OK
2. 进入 Folder → **Configure**
3. **Properties → Environment variables → Add**，建议：


| Name                       | Value                                 |
| -------------------------- | ------------------------------------- |
| `VITE_PUBLIC_API_BASE_URL` | `https://api.wx.2000gallery.art`      |
| `VITE_OSS_PUBLIC_ORIGIN`   | `https://wx.oss.2000gallery.art`      |
| `VITE_API_SIGN_KEY`        | `admin-web`                           |
| `ADMIN_DEPLOY_PATH`        | `/www/wwwroot/wx.ht.2000gallery.art/` |
| `BACKEND_DEPLOY_PATH`      | `/www/wwwroot/art_data`               |
| `BT_NODE_PROJECT_NAME`     | `art_data`                            |
| `API_BASE_URL`             | `https://api.wx.2000gallery.art`      |
| `ADMIN_BASE_URL`           | `https://wx.ht.2000gallery.art`       |
| `WECOM_WEBHOOK_URL`        | （企微机器人 Webhook，可空）                    |
| `WECHAT_OA_APPID`          | （可空）                                  |
| `WECHAT_OA_SECRET`         | （可空）                                  |
| `WECHAT_OA_TEMPLATE_ID`    | （可空）                                  |
| `WECHAT_OA_TOUSER`         | （可空，多个 openid 英文逗号分隔）                 |


1. **Save**

下面 Job 都建在这个 Folder 里。

---

## 3.5 机器访问不了 GitHub：怎么加代理

Jenkins Master / Agent 若直连 `github.com`、`npm.pkg.github.com` 失败，需要代理。下面假设代理是：

```text
HTTP 代理：127.0.0.1:7890
# 或局域网代理：192.168.x.x:7890
# 改成你自己的地址和端口
```

### ① Jenkins 全局代理（插件更新、部分 HTTP 请求）

1. **Manage Jenkins → System**（或 **Plugins** 页里的代理设置，视版本而定）
2. 找到 **HTTP Proxy Configuration** / **HTTP 代理配置**
3. 填写：
   - **Server**：代理主机（如 `127.0.0.1`）
   - **Port**：代理端口（如 `7890`）
   - 若代理要账号：填 User name / Password
4. **No Proxy Host**：内网不要走代理，例如：

```text
localhost
127.*
192.168.*
*.local
```

5. **Save** / **Validate**（若有测试按钮可测）

> 仅配这里有时 **不够**：Git clone、npm 仍可能不走 Jenkins 全局代理，需再做 ②③。

### ② 系统 / 服务环境变量（推荐，Git + npm 都吃）

**若 Job 跑在 Linux Agent**（如 `192.168.0.61`），在 **Agent 机器**上给跑构建的用户配：

```bash
# 以 jenkins 用户为例；代理地址改成你的
sudo tee /etc/environment.d/proxy.conf <<'EOF'
http_proxy=http://127.0.0.1:7890
https_proxy=http://127.0.0.1:7890
HTTP_PROXY=http://127.0.0.1:7890
HTTPS_PROXY=http://127.0.0.1:7890
no_proxy=localhost,127.0.0.1,192.168.0.0/16
NO_PROXY=localhost,127.0.0.1,192.168.0.0/16
EOF
```

或写进 Agent 用户 `~/.bashrc` / systemd 里 Jenkins agent 服务的 `Environment=`。

**若用 Built-in、Jenkins 用 systemd 跑**，改 Master 服务：

```bash
sudo systemctl edit jenkins
```

加入：

```ini
[Service]
Environment="http_proxy=http://127.0.0.1:7890"
Environment="https_proxy=http://127.0.0.1:7890"
Environment="HTTP_PROXY=http://127.0.0.1:7890"
Environment="HTTPS_PROXY=http://127.0.0.1:7890"
Environment="no_proxy=localhost,127.0.0.1,192.168.0.0/16"
Environment="NO_PROXY=localhost,127.0.0.1,192.168.0.0/16"
```

然后：

```bash
sudo systemctl daemon-reload
sudo systemctl restart jenkins
```

Agent 是 SSH 拉起的：改 Agent 侧环境后，在 Jenkins Nodes 里对该节点 **Relaunch agent**。

### ③ 只给 Git 配代理（clone 专用）

在 **实际执行 git 的那台机器**（Agent）上，用跑 Job 的用户执行：

```bash
git config --global http.proxy http://127.0.0.1:7890
git config --global https.proxy http://127.0.0.1:7890
# 可选：仅对 GitHub
# git config --global http.https://github.com.proxy http://127.0.0.1:7890
```

取消代理：

```bash
git config --global --unset http.proxy
git config --global --unset https.proxy
```

### ④ npm / GitHub Packages（`npm ci`、2.3 Token）

同一台构建机：

```bash
npm config set proxy http://127.0.0.1:7890
npm config set https-proxy http://127.0.0.1:7890
```

或在 Job 环境 / Folder 属性里加同名 `HTTP_PROXY` / `HTTPS_PROXY`（若 ② 已覆盖可不再设）。

### ⑤ 先在机器上自测

在 **跑 CI 的那台**（Agent 或 Master）上：

```bash
curl -I https://github.com
git ls-remote https://github.com/bei123/art_data.git
# 需要 TOKEN 时：
# git ls-remote https://<TOKEN>@github.com/bei123/art_data.git
```

`curl` / `git` 通了，再回 Jenkins 扫分支、构建。

### 注意

- 代理若在 **你的电脑** 上，Agent 是另一台机：Agent 填的应是「Agent 能访问到的代理地址」，不是瞎填 `127.0.0.1`（除非代理就装在 Agent 本机）。
- 生产机 SSH/rsync **不要**误走代理；`no_proxy` 里加上生产 IP / `192.168.*`。
- 公司 HTTP 代理常见端口：`7890`、`10809`、`8080`、`3128`，以你实际为准。

---

## 4. Job：`art_data-ci`（Multibranch）

1. Folder 内 **New Item**
2. 名称：`art_data-ci`
3. 类型：**Multibranch Pipeline** → OK
4. **Branch Sources → Add source → GitHub**（或 Git）
  - Repository：`https://github.com/bei123/art_data.git`（或 SSH URL）
  - Credentials：选 `art-data-git`
  - Behaviors：默认即可；可勾选 Discover pull requests from origin
5. **Build Configuration**
  - Mode：**by Jenkinsfile**
  - Script Path：`Jenkinsfile`
6. **Scan Multibranch Pipeline Triggers**
  - 勾选 Periodically if not otherwise run（如 `1 hour`）
  - 若装了 Webhook Trigger：勾选，记下 URL，到 GitHub → Settings → Webhooks 添加
7. **Save** → 自动 Scan
8. 点进某个分支 → **Build now**，确认 Lint / Test / Build 通过

---

## 5. Job：`art_data-deploy`（生产部署）

1. Folder 内 **New Item**
2. 名称：`art_data-deploy`
3. 类型：**Pipeline** → OK
4. **General**
  - 勾选 **This project is parameterized**（首次保存后 Pipeline 会从 Jenkinsfile 加载 `REF` / `FORCE_FULL`；也可先不勾，第一次跑完再出现）
  - 勾选 **Do not allow concurrent builds**（可选；Jenkinsfile 已有 `disableConcurrentBuilds`）
5. **Build Triggers**（二选一）
  - **GitHub hook trigger for GITScm polling**：需 GitHub 插件 + 仓库 Webhook  
  - 或 **Generic Webhook Trigger**：Token 自定，GitHub Webhook Payload URL 指向该 Job
6. **Pipeline**
  - Definition：**Pipeline script from SCM**
  - SCM：**Git**
  - Repository URL：同仓库
  - Credentials：`art-data-git`
  - Branches to build：`*/main`（或 `*/master`）
  - Script Path：`jenkins/Jenkinsfile.deploy`
  - 轻量检出：可勾选 Lightweight checkout
7. **Save**

### 首次验证（建议手动）

1. 打开 `art_data-deploy` → **Build with Parameters**
2. `REF`：留空
3. `FORCE_FULL`：**勾选**（第一次全量）
4. **Build**
5. 看阶段：Checkout → Detect → Install & test → Build admin → Deploy admin → Sync backend → Smoke
6. 浏览器打开管理台 / `curl` API health；企微应收到通知（若已配 `WECOM_WEBHOOK_URL`）

### 日常自动

`main` 有 push 后应由 Webhook 触发；未勾选 `FORCE_FULL` 时按路径增量部署。

---

## 6. Job：`art_data-rollback`（手动回滚）

1. **New Item** → `art_data-rollback` → **Pipeline** → OK
2. **Pipeline**
  - Pipeline script from SCM
  - 仓库 / Credentials 同上
  - Branches：`*/main`（脚本会再 checkout 参数 `REF`）
  - Script Path：`jenkins/Jenkinsfile.rollback`
3. **不要**勾选自动触发（仅手动）
4. **Save**

### 使用

1. **Build with Parameters**
2. `REF`：填 tag 或 SHA，例如 `v1.2.3`
3. **Build** → 等 Smoke 通过

---

## 7. Job：`art_data-release`（打 tag 发产物）

1. **New Item** → `art_data-release` → **Pipeline** → OK
  （或再用一个 Multibranch，只发现 tags；下面按单 Job + 手动/tag 触发写）
2. **Pipeline script from SCM**
  - Branches to build：可用 `*/main`，真正发版时用参数/tag 作业；更简单做法：
  - 勾选 **Build when a change is pushed to GitHub** 并在 GitHub 只对 `tag` 推送触发（视插件而定）
3. Script Path：`jenkins/Jenkinsfile.release`
4. Agent 上若要用 GitHub Release：安装 `gh`，并配好 `art-data-github-token`
5. **Save** → 推送 `v`* tag 后构建，Artifacts 里应有 `art-data-admin-dist.tar.gz` / `.zip`

若 tag 触发不好配：每次发版 **Build with Parameters** 前先把 SCM 分支改成对应 tag，或改用 Multibranch 发现 tags。

---

## 8. Job：`art_data-audit`（周审计）

1. **New Item** → `art_data-audit` → **Pipeline** → OK
2. Pipeline script from SCM
  - Branches：`*/main`
  - Script Path：`jenkins/Jenkinsfile.audit`
3. Jenkinsfile 内已有 `cron('H 2 * * 1')`；若 UI 也要显示，可再勾 **Build periodically**（二选一即可，避免双触发）
4. **Save** → **Build Now** 试跑一次

---

## 9. GitHub Webhook（Deploy + CI）

仓库：**Settings → Webhooks → Add webhook**


| 项            | 建议                                                      |
| ------------ | ------------------------------------------------------- |
| Payload URL  | Jenkins 提供的 GitHub hook URL，或 Generic Webhook 的 Job URL |
| Content type | `application/json`                                      |
| Secret       | 与 Jenkins GitHub 插件 / Generic Token 一致                  |
| Which events | 至少勾选 **Pushes**；CI 要 PR 则加 **Pull requests**            |
| Active       | 勾选                                                      |


推一个空 commit 或开 PR，确认 `art_data-ci` / `art_data-deploy` 有新构建。

---

## 10. 上线前检查清单

- [ ] `.github/workflows/` 下没有启用的 deploy YAML（应只有 README；旧文件在 `workflows-archived/`）
- [ ] Credentials ID 与 Pipeline 完全一致（尤其 `art-data-ssh`、`node-24`）
- [ ] 服务器 `authorized_keys` 含 Jenkins 公钥；安全组放行 Jenkins agent → 22
- [ ] 手动 `FORCE_FULL` Deploy 成功 + smoke 通过
- [ ] Rollback 用一个已知 tag 演练一次（或 staging）
- [ ] 通知：企微 / 公众号至少通一路
- [ ] 约定：发版只走 Jenkins，不再开 GitHub Actions 生产部署

---

## 11. 日常怎么用（给开发）

```text
feature/* → 开 PR → art_data-ci 绿灯 → merge main
         → art_data-deploy 自动跑 → smoke 通过
出问题 → art_data-rollback，REF=上一好版本
```

手动全量：`art_data-deploy` → Build with Parameters → 勾选 `FORCE_FULL`。

---

## 常见点错位置


| 现象                                        | 多半原因                                    |
| ----------------------------------------- | --------------------------------------- |
| `No tool named node-24`                   | Tools 里 Name 不是 `node-24`               |
| `Could not find credentials art-data-ssh` | ID 拼写或建在了别的 Domain                      |
| `Permission denied (publickey)`           | 公钥未进服务器 / Username 不对                   |
| `401` 装 `@bei123/*`                       | `art-data-node-auth-token` 无效或权限不足      |
| 管理台登录签名失败                                 | `art-data-vite-api-sign-secret` 与服务器不一致 |
| Deploy 与旧 Actions 抢发                      | 把 Actions workflow 重新启用了                |


更细的 Secrets/冒烟说明仍以 [CI-CD.md](./CI-CD.md) 为准。