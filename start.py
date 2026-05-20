import subprocess
import sys
import time
import os
import signal


def kill_port(port):
    try:
        result = subprocess.run(["lsof", "-ti", f":{port}"], capture_output=True, text=True)
        pids = result.stdout.strip().split()
        for pid in pids:
            if pid:
                os.kill(int(pid), signal.SIGKILL)
    except Exception:
        pass


def kill_script(name):
    try:
        subprocess.run(["pkill", "-9", "-f", f"python.*{name}$"], capture_output=True)
    except Exception:
        pass


def main():
    print("🧹 Завершаем старые процессы...")
    kill_port(8080)
    kill_script("main.py")
    kill_script("support_bot.py")
    kill_script("bot.py")
    time.sleep(2)

    print("🚀 Запускаем только FastAPI сервер с webhook...")
    server_process = subprocess.Popen([sys.executable, "main.py"])

    try:
        server_process.wait()
    except KeyboardInterrupt:
        print("\n⏹️ Выключение...")
        server_process.terminate()


if __name__ == "__main__":
    main()
