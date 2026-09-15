import os
import socket
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, wait as futures_wait

if sys.platform == 'win32':
    import ctypes

HOSTS_PATH = (
    r'C:\Windows\System32\drivers\etc\hosts'
    if sys.platform == 'win32'
    else '/etc/hosts'
)

_MARKER    = '# [py-course-focus]'
_FW_PREFIX = 'PyCourse-focus'
_DOH_RULE  = f'{_FW_PREFIX}-doh-servers'

BLOCKED_DOMAINS = [
    'claude.ai', 'www.claude.ai', 'anthropic.com', 'www.anthropic.com',
    'chatgpt.com', 'www.chatgpt.com', 'chat.openai.com',
    'openai.com', 'www.openai.com',
    'gemini.google.com', 'aistudio.google.com',
    'copilot.microsoft.com', 'copilot.bing.com',
    'perplexity.ai', 'www.perplexity.ai',
    'poe.com', 'www.poe.com',
    'you.com', 'www.you.com',
    'phind.com', 'www.phind.com',
    'character.ai', 'www.character.ai',
    'chat.mistral.ai', 'mistral.ai',
    'cohere.com', 'www.cohere.com',
    'huggingface.co', 'www.huggingface.co',
    'groq.com', 'console.groq.com',
    'grok.x.ai', 'x.ai',
    'reddit.com', 'www.reddit.com', 'old.reddit.com',
    'x.com', 'www.x.com', 'twitter.com', 'www.twitter.com',
    'instagram.com', 'www.instagram.com',
    'facebook.com', 'www.facebook.com',
    'tiktok.com', 'www.tiktok.com',
    'twitch.tv', 'www.twitch.tv',
    'discord.com', 'www.discord.com',
]

_DOH_HOSTNAMES = [
    'dns.google', 'dns64.dns.google',
    'cloudflare-dns.com', 'mozilla.cloudflare-dns.com',
    'chrome.cloudflare-dns.com', 'family.cloudflare-dns.com',
    'dns.quad9.net', 'dns11.quad9.net',
    'dns.brave.com',
    'doh.opendns.com', 'doh.familyshield.opendns.com',
    'dns.adguard.com', 'dns-unfiltered.adguard.com',
    'doh.cleanbrowsing.org',
]

_DOH_IPS = [
    '8.8.8.8', '8.8.4.4',
    '2001:4860:4860::8888', '2001:4860:4860::8844',
    '1.1.1.1', '1.0.0.1',
    '2606:4700:4700::1111', '2606:4700:4700::1001',
    '9.9.9.9', '149.112.112.112',
    '2620:fe::fe', '2620:fe::9',
    '208.67.222.222', '208.67.220.220',
    '2620:119:35::35', '2620:119:53::53',
    '94.140.14.14', '94.140.15.15',
    '2a10:50c0::ad1:ff', '2a10:50c0::ad2:ff',
]


def is_admin() -> bool:
    if sys.platform == 'win32':
        try:
            return bool(ctypes.windll.shell32.IsUserAnAdmin())
        except Exception:
            return False
    return os.geteuid() == 0


def is_focus_active() -> bool:
    try:
        with open(HOSTS_PATH, 'r', encoding='utf-8') as f:
            return _MARKER in f.read()
    except Exception:
        return False


def _flush_dns() -> None:
    if sys.platform == 'win32':
        subprocess.run(['ipconfig', '/flushdns'], capture_output=True)


def _write_hosts_block() -> None:
    all_hosts = list(BLOCKED_DOMAINS) + list(_DOH_HOSTNAMES)
    entries = '\n'.join(f'0.0.0.0  {d}  {_MARKER}' for d in all_hosts)
    with open(HOSTS_PATH, 'a', encoding='utf-8') as f:
        f.write('\n' + entries + '\n')


def _clear_hosts_block() -> None:
    with open(HOSTS_PATH, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    with open(HOSTS_PATH, 'w', encoding='utf-8') as f:
        f.writelines(l for l in lines if _MARKER not in l)


def _resolve_ips(domain: str) -> list[str]:
    try:
        infos = socket.getaddrinfo(domain, 443, type=socket.SOCK_STREAM)
        return list({info[4][0] for info in infos})[:8]
    except Exception:
        return []


def _fw_rule_name(domain: str) -> str:
    return f'{_FW_PREFIX}-{domain.replace(".", "-")}'


def _fw_block(domain: str) -> None:
    ips = _resolve_ips(domain)
    if not ips:
        return
    name = _fw_rule_name(domain)
    subprocess.run(
        ['netsh', 'advfirewall', 'firewall', 'delete', 'rule', f'name={name}'],
        capture_output=True,
    )
    subprocess.run([
        'netsh', 'advfirewall', 'firewall', 'add', 'rule',
        f'name={name}', 'dir=out', 'action=block',
        f'remoteip={",".join(ips)}', 'enable=yes',
    ], capture_output=True)


def _fw_unblock(domain: str) -> None:
    subprocess.run(
        ['netsh', 'advfirewall', 'firewall', 'delete', 'rule',
         f'name={_fw_rule_name(domain)}'],
        capture_output=True,
    )


def _apply_domain_rules() -> None:
    if sys.platform != 'win32':
        return
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = [pool.submit(_fw_block, d) for d in BLOCKED_DOMAINS]
        futures_wait(futures, timeout=25)


def _remove_domain_rules() -> None:
    if sys.platform != 'win32':
        return
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = [pool.submit(_fw_unblock, d) for d in BLOCKED_DOMAINS]
        futures_wait(futures, timeout=15)


def _block_doh_servers() -> None:
    if sys.platform != 'win32':
        return
    ips = ','.join(_DOH_IPS)
    subprocess.run(
        ['netsh', 'advfirewall', 'firewall', 'delete', 'rule', f'name={_DOH_RULE}'],
        capture_output=True,
    )
    subprocess.run([
        'netsh', 'advfirewall', 'firewall', 'add', 'rule',
        f'name={_DOH_RULE}', 'dir=out', 'action=block',
        'protocol=TCP', 'remoteport=443,853',
        f'remoteip={ips}', 'enable=yes',
    ], capture_output=True)


def _unblock_doh_servers() -> None:
    if sys.platform != 'win32':
        return
    subprocess.run(
        ['netsh', 'advfirewall', 'firewall', 'delete', 'rule', f'name={_DOH_RULE}'],
        capture_output=True,
    )


def enable_focus() -> dict:
    if not is_admin():
        return {'success': False, 'error': 'admin_required'}
    try:
        if not is_focus_active():
            _write_hosts_block()
            _flush_dns()
        _apply_domain_rules()
        _block_doh_servers()
        return {'success': True}
    except PermissionError:
        return {'success': False, 'error': 'admin_required'}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def disable_focus() -> dict:
    if not is_admin():
        return {'success': False, 'error': 'admin_required'}
    try:
        _clear_hosts_block()
        _flush_dns()
        _remove_domain_rules()
        _unblock_doh_servers()
        return {'success': True}
    except PermissionError:
        return {'success': False, 'error': 'admin_required'}
    except Exception as e:
        return {'success': False, 'error': str(e)}
