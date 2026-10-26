"""
系统信息与配置API
系统状态/数据库统计/模拟模式切换/系统配置管理
"""

import logging
from pathlib import Path
import yaml
from functools import wraps
from flask import Blueprint, jsonify, request, current_app
from datetime import datetime

from 用户层.auth import role_required, jwt_required
from ._common import load_yaml_config, save_yaml_config, api_error
import paths
from core.version import get_version

logger = logging.getLogger(__name__)

system_bp = Blueprint('api_system', __name__, url_prefix='/api')


# ==================== 系统信息API ====================

@system_bp.route('/system/status', methods=['GET'])
@jwt_required
def get_system_status():
    """获取系统状态

    Query params:
        brief: 1=返回精简设备状态（100+设备场景），0=完整状态（默认）
    """
    start_time = getattr(current_app, 'system_start_time', None)
    uptime_seconds = (datetime.now() - start_time).total_seconds() if start_time else 0

    brief = request.args.get('brief', '0') == '1'

    return jsonify({
        'version': get_version(),
        'database': current_app.database.get_database_stats(),
        'devices': current_app.device_manager.get_all_status(brief=brief),
        'collector': current_app.data_collector.get_stats(),
        'alarms': current_app.alarm_manager.get_alarm_statistics(),
        'uptime_seconds': uptime_seconds,
        'start_time': start_time.isoformat() if start_time else None,
        'simulation_mode': current_app.device_manager.simulation_mode
    })


@system_bp.route('/system/database', methods=['GET'])
@jwt_required
def get_database_stats():
    """获取数据库统计"""
    return jsonify(current_app.database.get_database_stats())


@system_bp.route('/system/simulation-mode', methods=['GET'])
@jwt_required
def get_simulation_mode():
    """获取当前模拟/真实模式状态"""
    return jsonify({
        'simulation_mode': current_app.device_manager.simulation_mode
    })


@system_bp.route('/system/simulation-mode', methods=['POST'])
@role_required('admin', 'engineer')
def toggle_simulation_mode():
    """切换模拟/真实模式（运行时热切换，无需重启）"""
    data = request.get_json() or {}
    new_mode = data.get('simulation_mode')

    if new_mode is None:
        return jsonify({'success': False, 'message': '缺少simulation_mode参数'}), 400

    new_mode = bool(new_mode)

    # 运行时热切换
    dm = current_app.device_manager
    result = dm.switch_simulation_mode(new_mode)

    # 同时更新配置文件（持久化）
    config_path = paths.resolve('配置/system.yaml')
    if config_path.exists():
        with open(config_path, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f) or {}
    else:
        config = {}

    if 'system' not in config:
        config['system'] = {}
    config['system']['simulation_mode'] = new_mode

    config_path.parent.mkdir(parents=True, exist_ok=True)
    with open(config_path, 'w', encoding='utf-8') as f:
        yaml.dump(config, f, allow_unicode=True, default_flow_style=False)

    return jsonify(result)


# ==================== 系统配置API ====================

@system_bp.route('/config', methods=['GET'])
@jwt_required
def get_config():
    """获取系统配置（过滤敏感字段）"""
    config = load_yaml_config('配置/system.yaml')
    if not config:
        return api_error('配置文件不存在', 404)
    # 移除敏感字段，防止密钥泄露
    sensitive_keys = {'secret_key', 'jwt_secret', 'password', 'token', 'api_key'}
    def _sanitize(obj):
        if isinstance(obj, dict):
            return {k: ('***' if k.lower() in sensitive_keys else _sanitize(v))
                    for k, v in obj.items()}
        elif isinstance(obj, list):
            return [_sanitize(i) for i in obj]
        return obj
    return jsonify({'config': _sanitize(config)})


# ==================== 高可用API ====================

@system_bp.route('/system/ha-status', methods=['GET'])
@jwt_required
def get_ha_status():
    """获取高可用状态"""
    ha_manager = getattr(current_app, 'ha_manager', None)
    if not ha_manager:
        return jsonify({'enabled': False, 'message': 'HA未启用'}), 200
    return jsonify({'enabled': True, **ha_manager.get_status()})


@system_bp.route('/system/ha-force-role', methods=['POST'])
@role_required('admin')
def ha_force_role():
    """强制切换HA角色"""
    ha_manager = getattr(current_app, 'ha_manager', None)
    if not ha_manager:
        return jsonify({'success': False, 'message': 'HA未启用'}), 400

    data = request.get_json() or {}
    role_str = data.get('role', '').lower()

    if role_str not in ('primary', 'standby'):
        return jsonify({'success': False, 'message': 'role必须是primary或standby'}), 400

    from core.ha_manager import HARole
    ha_manager.force_role(HARole(role_str))
    return jsonify({'success': True, 'message': f'角色已切换为{role_str}', **ha_manager.get_status()})


@system_bp.route('/config', methods=['PUT'])
@role_required('admin', 'engineer')
def update_config():
    """更新系统配置"""
    from ._common import get_auth_manager

    data = request.get_json()
    if not data:
        return api_error('请提供配置数据')

    config = load_yaml_config('配置/system.yaml')
    # 深拷贝"改之前"的快照。diff 必须基于旧值，不能基于 config 对象引用——
    # 下面 update() 是原地改，拷引用等于 after==before，diff 永远是空的。
    import copy as _copy
    before_snapshot = _copy.deepcopy(config or {})

    section = data.get('section')
    # 安全配置只有管理员能改：装饰器放行 engineer 是为了让他调采集间隔之类的运维参数，
    # 不是让他改口令策略/会话超时。放行 engineer 却不区分段落，等于把安全策略交给了运维角色。
    _role = (request.current_user or {}).get('role')
    if _role != 'admin':
        if section == 'security':
            return api_error('security 段仅管理员可修改', 403)
        if not section:
            data = {k: v for k, v in data.items() if k != 'security'}

    if section and section in config and isinstance(config[section], dict):
        config[section].update(data.get('data', {}))
    elif section:
        return jsonify({'success': False, 'message': f'配置段 {section} 不存在或不是字典'}), 400
    else:
        # 安全限制：只允许更新白名单中的顶层字段
        allowed_keys = {'system', 'web', 'security'}
        filtered = {k: v for k, v in data.items() if k in allowed_keys}
        if not filtered:
            return jsonify({'success': False, 'message': '无有效的配置段'}), 400
        config.update(filtered)

    if not save_yaml_config('配置/system.yaml', config):
        return jsonify({'success': False, 'message': '配置保存失败'}), 500

    # ---- 变更审计（SEC-03 / GB/T 22239-2019 8.1.4.3）----------------------
    # 只记"更新了系统配置"是不够的：出了事要能回答「谁把报警阈值从 180 改成 200」。
    # 这里落 before/after diff，并写入哈希链（core/audit_chain.py），
    # 使日志本身被改动也能被 verify_chain 抓出来。
    audit_state = 'recorded'
    audit_entries = []
    try:
        from core.audit_chain import record_config_change
        actor = request.current_user['username']
        ip = request.remote_addr
        scopes = [section] if section else sorted(filtered.keys())
        with current_app.database.get_connection() as conn:
            for sc in scopes:
                rec = record_config_change(
                    conn, actor=actor, section=sc,
                    before=before_snapshot.get(sc) or {},
                    after=config.get(sc) or {},
                    ip=ip,
                )
                if rec:
                    audit_entries.append({'section': sc, **rec})
        if not audit_entries:
            # 请求成功但没有任何键变化：不写空记录（否则日志被噪音灌满），
            # 但要如实告诉调用方"这次没有变更"，而不是假装记了一笔。
            audit_state = 'no_change'
    except Exception as e:  # 审计失败不能让配置保存回滚，但绝不能静默
        audit_state = 'degraded'
        logger.error(f"配置变更审计写入失败（配置已保存，审计缺失）: {e}")

    get_auth_manager().log_operation(
        request.current_user['username'], 'update_config', f"更新系统配置: {section or 'global'}")

    detail = {'sections': [e['section'] for e in audit_entries],
              'changes': sum(e['changes'] for e in audit_entries)}
    return jsonify({'success': True, 'message': '配置已保存',
                    'audit': audit_state, 'audit_detail': detail})


# ==================== 前端错误日志上报 ====================

_client_error_logger = logging.getLogger('client_error')


@system_bp.route('/system/client-errors', methods=['POST'])
def report_client_errors():
    """接收前端错误日志上报

    等保2.0 GB/T 22239 要求：应记录安全事件，便于事后追溯。
    无需认证（错误可能发生在认证失败时），但限流保护。
    """
    data = request.get_json()
    if not data or 'errors' not in data:
        return jsonify({'success': False, 'message': '无效的错误数据'}), 400

    errors = data['errors']
    if not isinstance(errors, list) or len(errors) > 50:
        return jsonify({'success': False, 'message': '错误数据格式不正确'}), 400

    client_ip = request.remote_addr or 'unknown'
    for err in errors:
        _client_error_logger.warning(
            "前端错误 [%s] %s | url=%s user=%s ip=%s",
            err.get('type', 'unknown'),
            err.get('message', '')[:200],
            err.get('url', ''),
            err.get('userId', 'anonymous'),
            client_ip,
            extra={'client_error': err}
        )

    return jsonify({'success': True, 'received': len(errors)})
