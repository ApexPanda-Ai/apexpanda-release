#!/bin/bash
# ApexPanda - 自动安装 Docker 并拉取镜像
# 适配 Ubuntu / Debian / CentOS / RHEL / Rocky Linux / AlmaLinux
# 镜像源：无法访问 Docker Hub 时自动使用国内源（华为云 SWR）；也可设置 USE_CHINA_MIRROR=1 强制国内源

set -euo pipefail

# 官方 Docker Hub 与国内镜像（华为云 SWR）
IMAGE_OFFICIAL="apexpanda/apexpanda:1.3.1"
IMAGE_DOMESTIC="swr.cn-east-3.myhuaweicloud.com/apexpanda/apexpanda:1.3.1"
IMAGE=""   # 由 detect_image_source 填充
DATA_DIR="/opt/apexpanda-data"
# 设为 1 可强制“全新拉取”：删除旧容器与本机同 tag 镜像后再拉取
CLEAN_PULL="${CLEAN_PULL:-0}"
# 设为 1 强制使用国内源，不检测网络
USE_CHINA_MIRROR="${USE_CHINA_MIRROR:-0}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1" >&2; exit 1; }

# ── 检查是否 root ──────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  error "请以 root 身份运行：sudo bash $0"
fi

# ── 检测发行版 ─────────────────────────────────────────────────────
detect_os() {
  [ -f /etc/os-release ] || error "无法识别操作系统（缺少 /etc/os-release），请手动安装 Docker"
  . /etc/os-release
  OS_ID="${ID:-}"
  OS_ID_LIKE="${ID_LIKE:-}"
  OS_VERSION_CODENAME="${VERSION_CODENAME:-}"
  PRETTY_OS="${PRETTY_NAME:-$OS_ID}"

  case "$OS_ID" in
    ubuntu|debian|linuxmint|pop) OS_FAMILY="debian" ;;
    centos|rhel|rocky|almalinux|fedora|ol) OS_FAMILY="rhel" ;;
    *)
      if echo "$OS_ID_LIKE" | grep -qi "debian"; then
        OS_FAMILY="debian"
      elif echo "$OS_ID_LIKE" | grep -qi "rhel\|centos\|fedora"; then
        OS_FAMILY="rhel"
      else
        error "不支持的发行版: $OS_ID（ID_LIKE=$OS_ID_LIKE），请手动安装 Docker"
      fi
      ;;
  esac

  info "检测到系统：$PRETTY_OS（family=$OS_FAMILY）"
}

# ── 安装 Docker（Debian/Ubuntu） ───────────────────────────────────
install_docker_debian() {
  info "正在安装 Docker（Debian/Ubuntu 方式）..."
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg

  install -m 0755 -d /etc/apt/keyrings

  # 若 GPG key 已存在则覆盖，避免重复运行报错
  curl -fsSL "https://download.docker.com/linux/${OS_ID}/gpg" \
    | gpg --batch --yes --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  # 优先使用 /etc/os-release 中的 VERSION_CODENAME，避免依赖 lsb_release
  local codename="$OS_VERSION_CODENAME"
  if [ -z "$codename" ] && command -v lsb_release &>/dev/null; then
    codename=$(lsb_release -cs)
  fi
  [ -n "$codename" ] || error "无法获取系统代号（codename），请手动安装 Docker"

  local arch
  arch=$(dpkg --print-architecture)

  cat > /etc/apt/sources.list.d/docker.list <<EOF
deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${OS_ID} ${codename} stable
EOF

  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

# ── 安装 Docker（CentOS/RHEL/Rocky/AlmaLinux） ────────────────────
install_docker_rhel() {
  info "正在安装 Docker（RHEL/CentOS 方式）..."

  # 移除旧版（忽略错误）
  local pkg_mgr
  if command -v dnf &>/dev/null; then
    pkg_mgr="dnf"
  else
    pkg_mgr="yum"
  fi

  $pkg_mgr remove -y docker docker-client docker-client-latest docker-common \
    docker-latest docker-latest-logrotate docker-logrotate docker-engine \
    podman runc 2>/dev/null || true

  $pkg_mgr install -y yum-utils
  yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

  $pkg_mgr install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

# ── 启用并启动 Docker 服务 ─────────────────────────────────────────
start_docker_service() {
  if ! command -v systemctl &>/dev/null; then
    warn "未检测到 systemctl，跳过自启动配置（可能是容器或非 systemd 环境）"
    # 尝试直接启动 dockerd（如 Docker Desktop 或 OpenRC 环境）
    if ! docker info &>/dev/null 2>&1; then
      warn "Docker daemon 未运行，请手动启动：service docker start"
    fi
    return 0
  fi

  info "配置 Docker 开机自启..."
  systemctl enable docker 2>/dev/null || warn "systemctl enable docker 失败，可能已启用或无 unit 文件"
  systemctl start docker  2>/dev/null || warn "systemctl start docker 失败"

  local status
  status=$(systemctl is-active docker 2>/dev/null || echo "unknown")
  if [ "$status" = "active" ]; then
    info "Docker 服务状态：运行中（active）"
  else
    warn "Docker 服务状态：$status，请检查：systemctl status docker"
  fi
}

# ── 主流程 ─────────────────────────────────────────────────────────
detect_os

# 1. 检查 Docker 是否已安装
if command -v docker &>/dev/null; then
  info "Docker 已安装：$(docker --version)，跳过安装"
else
  warn "Docker 未安装，开始自动安装最新版..."
  case "$OS_FAMILY" in
    debian) install_docker_debian ;;
    rhel)   install_docker_rhel ;;
  esac
  info "Docker 安装完成：$(docker --version)"
fi

# 2. 启动 Docker 并设置开机自启
start_docker_service

# 3. 确认 Docker daemon 可用
if ! docker info &>/dev/null 2>&1; then
  error "Docker daemon 无法连接，请检查服务状态：systemctl status docker"
fi

# ── 选择镜像源：国内不可达 Docker Hub 时自动用华为云 SWR ─────────────────
choose_image_source() {
  if [ "$USE_CHINA_MIRROR" = "1" ]; then
    IMAGE="$IMAGE_DOMESTIC"
    info "已设置 USE_CHINA_MIRROR=1，使用国内镜像：$IMAGE"
    return
  fi
  local code
  code=$(curl -s --connect-timeout 3 --max-time 5 -o /dev/null -w "%{http_code}" "https://registry-1.docker.io/v2/" 2>/dev/null || echo "000")
  if [ "$code" = "200" ] || [ "$code" = "401" ]; then
    IMAGE="$IMAGE_OFFICIAL"
    info "使用官方镜像：$IMAGE"
  else
    IMAGE="$IMAGE_DOMESTIC"
    warn "无法访问 Docker Hub（状态 $code），自动切换国内镜像：$IMAGE"
  fi
}
choose_image_source

# 4. 拉取镜像
info "正在拉取镜像：$IMAGE"
if [ "$CLEAN_PULL" = "1" ]; then
  warn "CLEAN_PULL=1：将删除旧容器与本机旧镜像，然后重新拉取"
  if docker ps -a --format '{{.Names}}' | grep -q '^apexpanda$'; then
    warn "检测到已有同名容器，先停止并删除..."
    docker stop apexpanda 2>/dev/null || true
    docker rm apexpanda 2>/dev/null || true
  fi
  docker image rm -f "$IMAGE" 2>/dev/null || true
  # 清理悬空层，避免本机残留无用缓存
  docker image prune -f >/dev/null 2>&1 || true
fi
docker pull "$IMAGE"
info "镜像拉取完成"
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}" "$IMAGE"

# 5. 创建数据目录
mkdir -p "$DATA_DIR"
info "数据目录：$DATA_DIR"

# ── 自动启动 ApexPanda 容器 ────────────────────────────────────────
info "正在启动 ApexPanda 容器..."

# 若同名容器已存在则先停止并删除
if docker ps -a --format '{{.Names}}' | grep -q '^apexpanda$'; then
  warn "检测到已有同名容器，先停止并删除..."
  docker stop apexpanda 2>/dev/null || true
  docker rm apexpanda 2>/dev/null || true
fi

docker run --pull=always -d -p 18790:18790 --name apexpanda "${IMAGE}"

echo ""
info "✅ 全部完成！ApexPanda 已启动"
info "访问地址：http://<服务器IP>:18790"
echo ""
