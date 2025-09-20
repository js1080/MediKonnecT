// Firebase 설정
const firebaseConfig = {
    apiKey: "AIzaSyB-RC-JAHIl6yGjW679Zci-yV_GzcoJ4cQ",
    authDomain: "mediconnect-pwa.firebaseapp.com",
    databaseURL: "https://mediconnect-pwa-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "mediconnect-pwa",
    storageBucket: "mediconnect-pwa.firebasestorage.app",
    messagingSenderId: "649141960908",
    appId: "1:649141960908:web:2dd9d74cfdeb1b245f4269",
    measurementId: "G-2MFS65V6PR"
};

// Firebase 초기화
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const database = firebase.database();
const storage = firebase.storage();

// 전역 변수
let currentUser = null;
let currentUserType = 'patient';
let signupUserType = 'patient';
let selectedTimeSlot = null;
let currentChatPatientId = null;
let chatMessagesListener = null;
let notificationInterval = null;
let currentPrescribingPatient = { id: null, name: null };
let isChatListenerActive = false; // 채팅 리스너 중복 방지
let lastLoadedMessageTimestamp = null; // 마지막 로드된 메시지 타임스탬프
let isGuardianVerified = false;
let selectedPatientForVerification = null;
let guardianManagedPatients = [];

// =============================================
// ### 알림 관련 함수들 (먼저 정의) ###
// =============================================

// 알림 권한 요청 함수
function requestNotificationPermission() {
    if ('Notification' in window) {
        if (Notification.permission === 'default') {
            Notification.requestPermission().then(function(permission) {
                if (permission === 'granted') {
                    console.log('알림 권한이 허용되었습니다.');
                } else {
                    console.log('알림 권한이 거부되었습니다.');
                }
            });
        }
    } else {
        console.log('이 브라우저는 알림을 지원하지 않습니다.');
    }
}

// 환자 알림 수신 함수
function listenForNotifications() {
    if (!currentUser) return;
    
    // 환자의 알림 데이터베이스 참조
    const notificationsRef = database.ref(`notifications/${currentUser.uid}`);
    
    // 새로운 알림 수신 대기
    notificationsRef.on('child_added', function(snapshot) {
        const notification = snapshot.val();
        if (notification && !notification.read) {
            // 브라우저 알림 표시
            showBrowserNotification(notification.message);
            
            // 대시보드에 알림 표시 (즉시)
            updatePatientNotifications();
            
            // 알림을 읽음으로 표시 (5초 후)
            setTimeout(() => {
                snapshot.ref.update({ read: true }).then(() => {
                    // 읽음 처리 후 알림 목록 다시 업데이트
                    updatePatientNotifications();
                });
            }, 5000); // 5초 후 읽음 처리
        }
    });
}

// 브라우저 알림 표시 함수
function showBrowserNotification(message) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('MediKonnecT', {
            body: message,
            icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTkyIiBoZWlnaHQ9IjE5MiIgZmlsbD0iIzIxNzVmNCIgdmlld0JveD0iMCAwIDI0IDI0IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxwYXRoIGQ9Ik03IDEyYzAtNS41MjMgMy4yNjEtOS4wMTggNy40My0xMC41ODhsLTEuMTctLjU4NEMxMS4zOTkgMi4xNSAxMC4yMzMgNiA5LjY0IDlIMTAuNjRjLjUxMi0yLjM5IDEuNDM1LTQuMTIzIDIuNTk2LTVIOVQ4aC0uNjRjLTEuNzggMi4wMzQtMi45MSA0LjcyOS0yLjk2IDhIMVY4aC0xdjhoMUMxIDEwLjczOSAyLjEzIDguMDg0IDQgNi4yOEMxLjI3IDguNjE4IDAgMTAuMTYgMCAxMmMwIDMuMzEgMi4wNyA2IDYgNnM2LTIuNjkgNi02eiI+PC9wYXRoPjwvc3ZnPg=='
        });
    }
}

// 환자 대시보드 알림 업데이트 함수
async function updatePatientNotifications() {
    if (!currentUser || currentUserType !== 'patient') return;
    
    try {
        // 최근 알림들을 가져오기 (읽음/안읽음 상관없이)
        const snapshot = await database.ref(`notifications/${currentUser.uid}`)
            .orderByChild('timestamp')
            .limitToLast(5)
            .once('value');
        
        const notifications = snapshot.val() || {};
        const notificationEl = document.getElementById('patientNotifications');
        
        if (notificationEl) {
            const notificationsList = Object.entries(notifications)
                .filter(([, notification]) => !notification.dismissed) // 제거되지 않은 알림만
                .sort(([, a], [, b]) => b.timestamp - a.timestamp); // 최신순 정렬
            
            if (notificationsList.length === 0) {
                notificationEl.innerHTML = '<div style="font-size: 12px; color: #28a745;">📢 새로운 알림이 없습니다.</div>';
            } else {
                let notificationHTML = '<div style="font-size: 12px; margin-top: 5px;">';
                
                // 읽지 않은 알림 개수 계산
                const unreadCount = notificationsList.filter(([, n]) => !n.read).length;
                
                if (unreadCount > 0) {
                    notificationHTML += `<div style="padding: 5px; margin: 2px 0; border-left: 3px solid #ffc107; color: #333;">
                        <strong>🔔 ${unreadCount}개의 새로운 알림</strong>
                    </div>`;
                }
                
                // 최근 알림들 표시 (최대 2개)
                notificationsList.slice(0, 2).forEach(([notificationId, notification]) => {
                    const isUnread = !notification.read;
                    const timeAgo = getTimeAgo(notification.timestamp);
                    
                    notificationHTML += `
                        <div 
                            id="notification-${notificationId}"
                            class="notification-item-dismissible"
                            style="
                                padding: 8px; 
                                margin: 3px 0; 
                                border-left: 3px solid ${isUnread ? '#2175f4' : '#dee2e6'};
                                color: ${isUnread ? '#2175f4' : '#333'};
                                ${isUnread ? 'font-weight: bold;' : ''}
                                cursor: pointer;
                                transition: all 0.3s ease;
                                position: relative;
                                user-select: none;
                            "
                            onclick="dismissNotification('${notificationId}')"
                            ontouchstart="handleNotificationTouchStart(event, '${notificationId}')"
                            ontouchmove="handleNotificationTouchMove(event, '${notificationId}')"
                            ontouchend="handleNotificationTouchEnd(event, '${notificationId}')"
                        >
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div style="flex: 1;">
                                    ${isUnread ? '🆕 ' : '📢 '}${notification.message}
                                    <div style="font-size: 10px; color: #666; margin-top: 2px;">${timeAgo}</div>
                                </div>
                                <div style="opacity: 0.5; font-size: 12px; margin-left: 10px;">✕</div>
                            </div>
                        </div>
                    `;
                });
                
                notificationHTML += '</div>';
                notificationEl.innerHTML = notificationHTML;
            }
        }
    } catch (error) {
        console.error('알림 업데이트 오류:', error);
    }
}

// 알림 제거 함수
async function dismissNotification(notificationId) {
    try {
        const notificationEl = document.getElementById(`notification-${notificationId}`);
        if (notificationEl) {
            notificationEl.style.transform = 'translateX(100%)';
            notificationEl.style.opacity = '0';
            
            setTimeout(async () => {
                // 알림 데이터 가져오기
                const notificationSnapshot = await database.ref(`notifications/${currentUser.uid}/${notificationId}`).once('value');
                const notificationData = notificationSnapshot.val();
                
                // 보호자의 상태 확인 알림인 경우 부작용 상태 해제
                if (notificationData && notificationData.type === 'guardian_side_effect_check') {
                    await clearSideEffectStatus();
                }
                
                // 데이터베이스에서 제거됨으로 표시
                await database.ref(`notifications/${currentUser.uid}/${notificationId}`).update({ 
                    dismissed: true,
                    dismissedAt: firebase.database.ServerValue.TIMESTAMP 
                });
                
                // 알림 목록 새로고침
                updatePatientNotifications();
            }, 300);
        }
    } catch (error) {
        console.error('알림 제거 오류:', error);
    }
}

// 터치 이벤트 처리 변수들
let touchStartX = 0;
let touchStartY = 0;
let isSwiping = false;
let currentNotificationId = null;

// 터치 시작
function handleNotificationTouchStart(event, notificationId) {
    touchStartX = event.touches[0].clientX;
    touchStartY = event.touches[0].clientY;
    isSwiping = false;
    currentNotificationId = notificationId;
}

// 터치 이동
function handleNotificationTouchMove(event, notificationId) {
    if (currentNotificationId !== notificationId) return;
    
    const touchX = event.touches[0].clientX;
    const touchY = event.touches[0].clientY;
    const deltaX = touchX - touchStartX;
    const deltaY = touchY - touchStartY;
    
    // 수평 스와이프인지 확인 (수직 스크롤 방해하지 않기)
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
        isSwiping = true;
        event.preventDefault(); // 스크롤 방지
        
        const notificationEl = document.getElementById(`notification-${notificationId}`);
        if (notificationEl && deltaX > 0) { // 오른쪽으로만 스와이프 허용
            const opacity = Math.max(0.3, 1 - (deltaX / 200));
            notificationEl.style.transform = `translateX(${deltaX}px)`;
            notificationEl.style.opacity = opacity;
        }
    }
}

// 터치 끝
function handleNotificationTouchEnd(event, notificationId) {
    if (currentNotificationId !== notificationId) return;
    
    const notificationEl = document.getElementById(`notification-${notificationId}`);
    if (!notificationEl) return;
    
    if (isSwiping) {
        const deltaX = event.changedTouches[0].clientX - touchStartX;
        
        if (deltaX > 100) { // 100px 이상 스와이프하면 제거
            dismissNotification(notificationId);
        } else {
            // 원래 위치로 되돌리기
            notificationEl.style.transform = 'translateX(0)';
            notificationEl.style.opacity = '1';
        }
    }
    
    // 초기화
    isSwiping = false;
    currentNotificationId = null;
}

// 시간 차이를 사용자 친화적으로 표시하는 함수
function getTimeAgo(timestamp) {
    const now = Date.now();
    const diffMs = now - timestamp;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    
    if (diffMins < 1) return '방금 전';
    if (diffMins < 60) return `${diffMins}분 전`;
    if (diffHours < 24) return `${diffHours}시간 전`;
    return new Date(timestamp).toLocaleDateString();
}

// 의료진 알림 로딩 함수
async function loadDoctorNotifications() {
    if (!currentUser || currentUserType !== 'doctor') return;
    
    try {
        // 오늘 날짜
        const today = new Date().toISOString().split('T')[0];
        
        // 1. 직접 추가된 환자들 가져오기
        const doctorPatientsSnapshot = await database.ref(`doctorPatients/${currentUser.uid}`).once('value');
        const directPatients = Object.keys(doctorPatientsSnapshot.val() || {});
        
        // 2. 처방전으로 연결된 환자들 가져오기
        const prescriptionsSnapshot = await database.ref('prescriptions').once('value');
        const prescriptions = prescriptionsSnapshot.val() || {};
        
        let prescriptionPatients = [];
        Object.entries(prescriptions).forEach(([patientId, patientPrescriptions]) => {
            const myActivePrescriptions = Object.values(patientPrescriptions).filter(p => 
                p.prescribedById === currentUser.uid && 
                p.isActive && 
                today >= p.startDate && 
                today <= p.endDate
            );
            if (myActivePrescriptions.length > 0) {
                prescriptionPatients.push(patientId);
            }
        });
        
        // 3. 전체 관리 환자 수 (중복 제거)
        const allManagedPatients = [...new Set([...directPatients, ...prescriptionPatients])];
        const totalPatients = allManagedPatients.length;
        
        // 답변 대기 중인 Q&A 확인
        const qnaSnapshot = await database.ref('qna').orderByChild('answer').equalTo(null).once('value');
        const unansweredQuestions = Object.keys(qnaSnapshot.val() || {}).length;
        
        // 읽지 않은 부작용 신고 확인
        const notificationsSnapshot = await database.ref(`notifications/${currentUser.uid}`)
            .orderByChild('type')
            .equalTo('side_effect_report')
            .once('value');
        const sideEffectReports = notificationsSnapshot.val() || {};
        const unreadSideEffects = Object.values(sideEffectReports).filter(n => !n.read).length;
        
        // 알림 메시지 업데이트
        const notificationEl = document.getElementById('doctorNotifications');
        if (notificationEl) {
            let message = `📊 관리 중인 환자: ${totalPatients}명`;
            if (unansweredQuestions > 0) {
                message += ` | ❓ 답변 대기: ${unansweredQuestions}건`;
            }
            if (unreadSideEffects > 0) {
                message += ` | ⚠️ 부작용 신고: ${unreadSideEffects}건`;
            }
            notificationEl.textContent = message;
            
            // 부작용 신고가 있으면 색상 변경
            if (unreadSideEffects > 0) {
                notificationEl.style.color = '#dc3545';
                notificationEl.style.fontWeight = 'bold';
            } else {
                notificationEl.style.color = '';
                notificationEl.style.fontWeight = '';
            }
        }
        
    } catch (error) {
        console.error('의료진 알림 로드 오류:', error);
        const notificationEl = document.getElementById('doctorNotifications');
        if (notificationEl) {
            notificationEl.textContent = '알림 로드 중 오류가 발생했습니다.';
        }
    }
}

function startNotificationUpdates() {
    if (currentUserType === 'doctor') {
        loadDoctorNotifications();
        notificationInterval = setInterval(loadDoctorNotifications, 30000);
    }
}

function stopNotificationUpdates() { 
    if (notificationInterval) {
        clearInterval(notificationInterval);
        notificationInterval = null;
    }
}

isGuardianVerified = false;
selectedPatientForVerification = null;
guardianManagedPatients = [];

// =============================================
// ### 핵심 로직 (인증, 화면 전환) ###
// =============================================

// 사용자 데이터 로드 (구조 개선)
async function loadUserData() {
    try {
        const snapshot = await database.ref('users/' + currentUser.uid).once('value');
        const userData = snapshot.val();
        if (userData) {
            currentUserType = userData.userType;
            if (userData.userType === 'patient') {
                document.getElementById('patientName').textContent = userData.name;
                showScreen('patientDashboard');
                
                // 알림 관련 함수들을 안전하게 호출
                try {
                    requestNotificationPermission();
                    listenForNotifications();
                    updatePatientNotifications();
                } catch (notificationError) {
                    console.log('알림 기능 초기화 오류:', notificationError);
                    // 알림 기능 오류가 있어도 계속 진행
                }
            } else if (userData.userType === 'guardian') {
                document.getElementById('guardianName').textContent = userData.name;
                showScreen('guardianDashboard');
                loadGuardianData();
            } else {
    document.getElementById('doctorName').textContent = userData.name;
    showScreen('doctorDashboard');
    startNotificationUpdates();
}
        }
    } catch (error) {
        console.error('사용자 데이터 로드 에러:', error);
    }
}

// 인증 상태 변화 감지
auth.onAuthStateChanged((user) => {
    if (user) {
        currentUser = user;
        loadUserData();
    } else {
        currentUser = null;
        showScreen('loginScreen');
    }
});

// 채팅 리스너 정리 함수
function clearChatListeners() {
    if (chatMessagesListener) {
        chatMessagesListener.off();
        chatMessagesListener = null;
    }
    isChatListenerActive = false;
    lastLoadedMessageTimestamp = null; // 타임스탬프도 초기화
}

// 화면 전환 함수 (데이터 로드 로직 통합) - 수정됨
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    const targetScreen = document.getElementById(screenId);
    if (targetScreen) {
        targetScreen.classList.add('active');
    }

    if (!currentUser) return;

    // 채팅 화면에서 나갈 때 리스너 정리
    if (screenId !== 'chatScreen') {
        clearChatListeners();
    }

    // 각 화면에 맞는 데이터 로드
    if (currentUserType === 'patient') {
        switch (screenId) {
            case 'medicationScreen':
                loadPatientMedicationSchedule();
                loadMedications();
                break;
            case 'qnaScreen':
                loadQnA();
                break;
            case 'chatScreen':
                // 채팅 화면으로 처음 진입할 때만 로드
                if (!isChatListenerActive) {
                    loadChatMessages();
                }
                break;
            case 'medicalRecordsScreen':
                loadMedicalRecords();
                break;
        }
    } else if (currentUserType === 'doctor') {
        // 의료진 화면 전환 시 데이터 새로고침
        switch (screenId) {
            case 'doctorChatListScreen': loadDoctorChatList(); break;
            case 'patientManagementScreen': loadPatientManagement(); break;
            case 'medicationGuideScreen': loadMedicationGuide(); break;
            case 'doctorScheduleScreen': loadDoctorSchedule(); break;
            case 'doctorQnaScreen': loadDoctorQnA(); break;
            // 의료진도 일반 Q&A 화면에 접근할 수 있도록 추가
            case 'qnaScreen': loadQnA(); break;
        }
    } else if (currentUserType === 'guardian') {
    // 보호자 화면 전환 시 데이터 로드
    switch (screenId) {
        
        case 'guardianMedicationScreen': loadGuardianMedicationScreen(); break;
        case 'guardianAppointmentScreen': loadGuardianAppointmentScreen(); break;
        case 'guardianRecordsScreen': loadGuardianRecordsScreen(); break;
        case 'qnaScreen': loadQnA(); break;
    }

    }
}

// =============================================
// ### 사용자 인증 및 관리 ###
// =============================================

function selectUserType(type) {
    currentUserType = type;
    document.querySelectorAll('#loginScreen .user-type').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
}

function selectSignupUserType(type) {
    signupUserType = type;
    document.querySelectorAll('#signupScreen .user-type').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    // 의료진 필드 표시/숨김
    document.getElementById('doctorFields').style.display = (type === 'doctor') ? 'block' : 'none';
    // 보호자 필드 표시/숨김 (추가된 부분)
    document.getElementById('guardianFields').style.display = (type === 'guardian') ? 'block' : 'none';
}

async function login() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) return showError('loginError', '이메일과 비밀번호를 입력해주세요.');
    try {
        showLoading(true);
        await auth.signInWithEmailAndPassword(email, password);
        showSuccess('loginSuccess', '로그인 성공!');
    } catch (error) {
        showError('loginError', getErrorMessage(error.code));
    } finally {
        showLoading(false);
    }
}

async function signup() {
    const name = document.getElementById('signupName').value;
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    if (!name || !email || !password) return showError('signupError', '모든 필드를 입력해주세요.');
    if (password.length < 6) return showError('signupError', '비밀번호는 6자 이상이어야 합니다.');
    
    // 보호자 특수 검증 추가
    if (signupUserType === 'guardian') {
        const relationshipType = document.getElementById('relationshipType').value;
        const guardianPhone = document.getElementById('guardianPhone').value;
        if (!relationshipType || !guardianPhone) {
            return showError('signupError', '보호자 정보를 모두 입력해주세요.');
        }
    }
    
    try {
        showLoading(true);
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const user = userCredential.user;
        const userData = { name, email, userType: signupUserType, createdAt: new Date().toISOString() };
        
        if (signupUserType === 'doctor') {
            userData.doctorType = document.getElementById('doctorType').value;
            userData.hospitalName = document.getElementById('hospitalName').value;
            userData.department = document.getElementById('department').value;
        } else if (signupUserType === 'guardian') {
            userData.relationshipType = document.getElementById('relationshipType').value;
            userData.guardianPhone = document.getElementById('guardianPhone').value;
            userData.emergencyContact = document.getElementById('emergencyContact').value;
        }
        
        await database.ref('users/' + user.uid).set(userData);
        showSuccess('signupSuccess', '회원가입 성공! 로그인 화면으로 이동합니다.');
        setTimeout(() => showLogin(), 2000);
    } catch (error) {
        showError('signupError', getErrorMessage(error.code));
    } finally {
        showLoading(false);
    }
}

// 로그아웃 함수 수정 (리스너 정리 추가)
async function logout() {
    try {
        // 모든 리스너 정리
        clearChatListeners();
        stopNotificationUpdates();
        
        await auth.signOut();
        showScreen('loginScreen');
        clearForms();
    } catch (error) {
        console.error('로그아웃 에러:', error);
    }
}

// =============================================
// ### 복약 처방 및 관리 기능 ###
// =============================================

// --- 의료진 기능 ---
async function loadPatientManagement() {
    const listEl = document.getElementById('patientManagementList');
    listEl.innerHTML = '<div class="loading" style="text-align: center;">환자 목록을 불러오는 중...</div>';
    
    console.log('=== 환자 관리 로드 디버깅 ===');
    console.log('현재 의사 ID:', currentUser.uid);
    
    try {
        const today = new Date().toISOString().split('T')[0];
        
        // 의사-환자 관계 정보 가져오기
        const doctorPatientsSnapshot = await database.ref(`doctorPatients/${currentUser.uid}`).once('value');
        const doctorPatients = doctorPatientsSnapshot.val() || {};
        console.log('직접 관리 환자:', doctorPatients);
        
        // 처방전 정보 가져오기
        const prescriptionsSnapshot = await database.ref('prescriptions').once('value');
        const allPrescriptions = prescriptionsSnapshot.val() || {};
        console.log('전체 처방전 개수:', Object.keys(allPrescriptions).length);
        
        // 사용자 정보 가져오기
        const usersSnapshot = await database.ref('users').once('value');
        const users = usersSnapshot.val() || {};
        
        listEl.innerHTML = '';
        
        // 환자 추가 버튼
        const addPatientBtn = document.createElement('button');
        addPatientBtn.className = 'btn';
        addPatientBtn.style.cssText = `
            width: 100%;
            padding: 15px;
            margin-bottom: 20px;
            background: #28a745;
            border: 2px dashed #20a038;
            font-size: 16px;
            font-weight: bold;
        `;
        addPatientBtn.innerHTML = '👤 새 환자 추가하기';
        addPatientBtn.onclick = showAddPatientModal;
        listEl.appendChild(addPatientBtn);
        
        // 관리 중인 환자들 수집
        const managedPatients = [];
        
        // 1. 직접 추가된 환자들
        for (const patientId of Object.keys(doctorPatients)) {
            const patient = users[patientId];
            if (patient && patient.userType === 'patient') {
                managedPatients.push({
                    id: patientId,
                    name: patient.name,
                    email: patient.email,
                    source: 'direct'
                });
            }
        }
        
        // 2. 처방전으로 연결된 환자들
        for (const [patientId, patientPrescriptions] of Object.entries(allPrescriptions)) {
            const patient = users[patientId];
            if (!patient || patient.userType !== 'patient') continue;
            
            // 이 의사가 처방한 활성 처방전이 있는지 확인
            const myActivePrescriptions = Object.values(patientPrescriptions).filter(p => 
                p.prescribedById === currentUser.uid && 
                p.isActive && 
                today >= p.startDate && 
                today <= p.endDate
            );
            
            if (myActivePrescriptions.length > 0) {
                // 이미 직접 추가된 환자가 아닌 경우에만 추가
                if (!managedPatients.find(p => p.id === patientId)) {
                    managedPatients.push({
                        id: patientId,
                        name: patient.name,
                        email: patient.email,
                        source: 'prescription',
                        activePrescriptions: myActivePrescriptions.length
                    });
                }
            }
        }
        
        if (managedPatients.length === 0) {
            const noPatients = document.createElement('div');
            noPatients.style.cssText = `
                text-align: center;
                padding: 40px 20px;
                color: #666;
                font-size: 16px;
                border: 2px dashed #e0e0e0;
                border-radius: 8px;
                margin-top: 20px;
            `;
            noPatients.innerHTML = `
                👥 관리 중인 환자가 없습니다<br>
                <small style="color: #999; font-size: 14px;">위의 "새 환자 추가하기" 버튼을 클릭하여 환자를 추가해보세요.</small>
            `;
            listEl.appendChild(noPatients);
            return;
        }
        
        // 환자 카드 생성
        managedPatients.forEach(patient => {
            const card = document.createElement('div');
            card.className = 'patient-card';
            card.style.cssText = `
                border: 1px solid #e0e0e0;
                border-radius: 8px;
                padding: 15px;
                margin-bottom: 15px;
                background: white;
                transition: all 0.2s ease;
            `;
            
            card.addEventListener('mouseenter', function() {
                this.style.backgroundColor = '#f8f9fa';
                this.style.borderColor = '#2175f4';
            });
            card.addEventListener('mouseleave', function() {
                this.style.backgroundColor = 'white';
                this.style.borderColor = '#e0e0e0';
            });
            
            // 활성 처방전이 있는 경우에만 라벨 표시
            let sourceLabel = '';
            if (patient.activePrescriptions) {
                sourceLabel = `<div style="font-size: 12px; color: #666; background: #e3f2fd; padding: 3px 8px; border-radius: 12px; display: inline-block;">활성 처방 ${patient.activePrescriptions}개</div>`;
            }
            
            card.innerHTML = `
                <div class="patient-info">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                        <div class="patient-name" style="font-weight: bold; color: #333;">👤 ${patient.name}</div>
                        ${sourceLabel}
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <button class="btn" style="width: auto; padding: 8px 16px; font-size: 14px;" onclick="showPrescriptionForm('${patient.id}', '${patient.name}')">새 처방하기</button>
                        <button class="btn" style="width: auto; padding: 8px 16px; font-size: 14px; background: #28a745;" onclick="showUploadRecordForm('${patient.id}', '${patient.name}')">기록 업로드</button>
                        ${patient.source === 'direct' ? `<button class="btn" style="width: auto; padding: 8px 16px; font-size: 14px; background: #dc3545;" onclick="removePatient('${patient.id}', '${patient.name}')">관리 해제</button>` : ''}
                    </div>
                </div>
            `;
            listEl.appendChild(card);
        });
        
    } catch (error) { 
        console.error("환자 목록 로드 에러:", error);
        listEl.innerHTML = '<p style="text-align: center; color: #dc3545;">환자 목록을 불러오는 중 오류가 발생했습니다.</p>';
    }
}

// 환자 추가 모달 표시
function showAddPatientModal() {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
    `;
    
    modal.innerHTML = `
        <div style="
            background: white;
            border-radius: 12px;
            padding: 30px;
            width: 90%;
            max-width: 400px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        ">
            <h3 style="margin: 0 0 20px 0; text-align: center; color: #333;">👥 환자 추가</h3>
            
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; font-weight: bold;">환자 검색</label>
                <input type="text" id="doctorPatientSearchInput" placeholder="환자 이름 또는 이메일 입력" style="
                    width: 100%;
                    padding: 12px;
                    border: 2px solid #e0e0e0;
                    border-radius: 8px;
                    font-size: 16px;
                " oninput="searchPatientsForDoctor(this.value)">
            </div>
            
            <div id="doctorPatientSearchResults" style="margin-bottom: 20px; max-height: 200px; overflow-y: auto;"></div>
            
            <div style="display: flex; gap: 10px;">
                <button onclick="closeAddPatientModal()" style="
                    flex: 1;
                    padding: 12px;
                    background: #6c757d;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                ">취소</button>
            </div>
        </div>
    `;
    
    modal.onclick = (e) => {
        if (e.target === modal) closeAddPatientModal();
    };
    
    document.body.appendChild(modal);
    document.getElementById('doctorPatientSearchInput').focus();
}

async function searchPatientsForDoctor(query) {
    const resultsDiv = document.getElementById('doctorPatientSearchResults');
    
    if (!query.trim()) {
        resultsDiv.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">환자 이름 또는 이메일을 입력하세요.</p>';
        return;
    }
    
    if (query.length < 2) {
        resultsDiv.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">2글자 이상 입력해주세요.</p>';
        return;
    }
    
    try {
        resultsDiv.innerHTML = '<p style="text-align: center; color: #666; padding: 15px;">검색 중...</p>';
        
        // 실제 Firebase에서 환자 검색
        const usersSnapshot = await database.ref('users').orderByChild('userType').equalTo('patient').once('value');
        const allPatients = usersSnapshot.val() || {};
        
        // 이미 관리 중인 환자 목록 가져오기
        const doctorPatientsSnapshot = await database.ref(`doctorPatients/${currentUser.uid}`).once('value');
        const alreadyManagedPatients = Object.keys(doctorPatientsSnapshot.val() || {});
        
        const searchResults = Object.entries(allPatients).filter(([patientId, patient]) => {
            const nameMatch = patient.name.toLowerCase().includes(query.toLowerCase());
            const emailMatch = patient.email.toLowerCase().includes(query.toLowerCase());
            const notAlreadyManaged = !alreadyManagedPatients.includes(patientId);
            
            return (nameMatch || emailMatch) && notAlreadyManaged;
        });
        
        if (searchResults.length === 0) {
            resultsDiv.innerHTML = '<p style="text-align: center; color: #666; padding: 15px; border: 1px solid #e0e0e0; border-radius: 5px; margin: 5px 0;">검색 결과가 없습니다.</p>';
            return;
        }
        
        resultsDiv.innerHTML = '';
        searchResults.forEach(([patientId, patient]) => {
            const resultCard = document.createElement('div');
            resultCard.style.cssText = `
                border: 1px solid #e0e0e0;
                border-radius: 8px;
                padding: 12px;
                margin-bottom: 8px;
                cursor: pointer;
                transition: all 0.2s ease;
                background: white;
            `;
            
            resultCard.addEventListener('mouseenter', function() {
                this.style.backgroundColor = '#f0f8ff';
                this.style.borderColor = '#2175f4';
            });
            resultCard.addEventListener('mouseleave', function() {
                this.style.backgroundColor = 'white';
                this.style.borderColor = '#e0e0e0';
            });
            
            resultCard.innerHTML = `
                <div style="font-weight: bold; margin-bottom: 5px;">👤 ${patient.name}</div>
                <div style="font-size: 14px; color: #666;">📧 ${patient.email}</div>
            `;
            
            resultCard.onclick = () => addPatientToManagement(patientId, patient.name);
            resultsDiv.appendChild(resultCard);
        });
        
    } catch (error) {
        console.error('환자 검색 오류:', error);
        resultsDiv.innerHTML = '<p style="text-align: center; color: #dc3545; padding: 15px;">검색 중 오류가 발생했습니다.</p>';
    }
}



// 환자를 관리 대상에 추가
async function addPatientToManagement(patientId, patientName) {
    console.log('환자 추가 시도:', patientId, patientName);
    console.log('현재 의사 ID:', currentUser.uid);
    
    try {
        showLoading(true);
        
        // 의사-환자 관계 저장
        await database.ref(`doctorPatients/${currentUser.uid}/${patientId}`).set({
            addedAt: firebase.database.ServerValue.TIMESTAMP,
            patientName: patientName
        });
        
        console.log('환자 추가 완료');
        
        // 환자에게 알림 전송
        await database.ref(`notifications/${patientId}`).push({
            message: `새로운 담당 의료진이 배정되었습니다. 앞으로 건강 관리를 도와드리겠습니다.`,
            read: false,
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            type: 'doctor_assigned',
            doctorId: currentUser.uid
        });
        
        alert(`${patientName} 환자가 관리 대상에 추가되었습니다.`);
        closeAddPatientModal();
        loadPatientManagement(); // 목록 새로고침
        
    } catch (error) {
        console.error('환자 추가 오류:', error);
        alert('환자 추가 중 오류가 발생했습니다: ' + error.message);
    } finally {
        showLoading(false);
    }
}

// 환자 관리 해제
async function removePatient(patientId, patientName) {
    if (!confirm(`${patientName} 환자를 관리 대상에서 해제하시겠습니까?`)) return;
    
    try {
        showLoading(true);
        
        await database.ref(`doctorPatients/${currentUser.uid}/${patientId}`).remove();
        
        alert(`${patientName} 환자가 관리 대상에서 해제되었습니다.`);
        loadPatientManagement(); // 목록 새로고침
        
    } catch (error) {
        console.error('환자 해제 오류:', error);
        alert('환자 해제 중 오류가 발생했습니다.');
    } finally {
        showLoading(false);
    }
}

// 모달 닫기
function closeAddPatientModal() {
    const modal = document.querySelector('div[style*="position: fixed"]');
    if (modal) {
        document.body.removeChild(modal);
    }
}

function showPrescriptionForm(patientId, patientName) {
    currentPrescribingPatient = { id: patientId, name: patientName };
    document.getElementById('prescribingPatientName').textContent = patientName;
    document.getElementById('prescriptionMedName').value = '';
    document.getElementById('prescriptionDosage').value = '';
    document.querySelectorAll('input[name="prescriptionTimes"]').forEach(cb => cb.checked = false);
    document.getElementById('prescriptionDuration').value = '7';
    document.getElementById('prescriptionInstructions').value = '';
    showScreen('prescriptionScreen');
}

async function submitPrescription() {
    const { id: patientId, name: patientName } = currentPrescribingPatient;
    const medName = document.getElementById('prescriptionMedName').value.trim();
    const dosage = document.getElementById('prescriptionDosage').value.trim();
    const duration = parseInt(document.getElementById('prescriptionDuration').value, 10);
    const instructions = document.getElementById('prescriptionInstructions').value.trim();
    const selectedTimes = Array.from(document.querySelectorAll('input[name="prescriptionTimes"]:checked')).map(cb => cb.value);

    if (!medName || !dosage || selectedTimes.length === 0) return alert('약물명, 용량, 복용 시간은 필수 입력 항목입니다.');
    
    const today = new Date();
    const startDate = today.toISOString().split('T')[0];
    const endDate = new Date(new Date().setDate(today.getDate() + duration - 1)).toISOString().split('T')[0];
    const prescriptionData = { medName, dosage, times: selectedTimes, duration, startDate, endDate, instructions, prescribedById: currentUser.uid, prescribedAt: firebase.database.ServerValue.TIMESTAMP, isActive: true };

    try {
        showLoading(true);
        await database.ref(`prescriptions/${patientId}`).push(prescriptionData);
        const notificationMsg = `새로운 ${duration}일치 약(${medName})이 처방되었습니다.`;
        await database.ref(`notifications/${patientId}`).push({ message: notificationMsg, read: false, timestamp: firebase.database.ServerValue.TIMESTAMP });
        alert(`${patientName}님에게 처방전이 전송되었습니다.`);
        goBack();
    } catch (error) {
        console.error("처방전 전송 에러:", error);
    } finally {
        showLoading(false);
    }
}

// 진료기록부 업로드 폼 표시
function showUploadRecordForm(patientId, patientName) {
    currentPrescribingPatient = { id: patientId, name: patientName };
    document.getElementById('uploadRecordPatientName').textContent = patientName;
    document.getElementById('recordTitle').value = '';
    document.getElementById('recordFile').value = '';
    document.getElementById('recordDescription').value = '';
    showScreen('uploadMedicalRecordScreen');
}

// 진료기록부 업로드 실행
async function uploadMedicalRecord() {
    const { id: patientId, name: patientName } = currentPrescribingPatient;
    const title = document.getElementById('recordTitle').value.trim();
    const fileInput = document.getElementById('recordFile');
    const description = document.getElementById('recordDescription').value.trim();
    
    if (!title || !fileInput.files[0]) {
        return alert('제목과 파일을 모두 입력해주세요.');
    }
    
    const file = fileInput.files[0];
    if (file.type !== 'application/pdf') {
        return alert('PDF 파일만 업로드 가능합니다.');
    }
    
    if (file.size > 10 * 1024 * 1024) { // 10MB 제한
        return alert('파일 크기는 10MB 이하여야 합니다.');
    }
    
    try {
        showLoading(true);
        
        // 파일명 생성 (중복 방지)
        const timestamp = new Date().getTime();
        const fileName = `${timestamp}_${file.name}`;
        
        // Storage에 파일 업로드
        const storageRef = storage.ref(`medical_records/${patientId}/${fileName}`);
        const uploadTask = await storageRef.put(file);
        const downloadURL = await uploadTask.ref.getDownloadURL();
        
        // 데이터베이스에 메타데이터 저장
        const recordData = {
            title,
            description,
            fileName: file.name,
            storagePath: fileName,
            downloadURL,
            uploadedBy: currentUser.uid,
            uploadedAt: firebase.database.ServerValue.TIMESTAMP,
            fileSize: file.size,
            patientId
        };
        
        await database.ref(`medicalRecords/${patientId}`).push(recordData);
        
        // 환자에게 알림 전송
        const notificationMsg = `새로운 진료기록부 '${title}'이 업로드되었습니다.`;
        await database.ref(`notifications/${patientId}`).push({
            message: notificationMsg,
            read: false,
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            type: 'medical_record'
        });
        
        alert(`${patientName} 환자의 진료기록부가 업로드되었습니다.`);
        goBack();
        
    } catch (error) {
        console.error('진료기록부 업로드 오류:', error);
        alert('업로드 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
        showLoading(false);
    }
}

// 환자용 진료기록부 목록 로드
async function loadMedicalRecords() {
    const recordsList = document.getElementById('medicalRecordsList');
    if (!recordsList || !currentUser) return;
    
    recordsList.innerHTML = '<div class="loading" style="text-align: center;">진료기록부를 불러오는 중...</div>';
    
    try {
        const snapshot = await database.ref(`medicalRecords/${currentUser.uid}`).orderByChild('uploadedAt').once('value');
        const records = snapshot.val() || {};
        
        recordsList.innerHTML = '';
        
        if (Object.keys(records).length === 0) {
            recordsList.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">등록된 진료기록부가 없습니다.</p>';
            return;
        }
        
        // 최신순으로 정렬
        const sortedRecords = Object.entries(records).sort(([,a], [,b]) => b.uploadedAt - a.uploadedAt);
        
        for (const [recordId, record] of sortedRecords) {
            const recordCard = document.createElement('div');
            recordCard.className = 'patient-card';
            recordCard.style.cssText = `
                border: 1px solid #e0e0e0;
                border-radius: 8px;
                padding: 15px;
                margin-bottom: 15px;
                background: white;
            `;
            
            const uploadDate = new Date(record.uploadedAt).toLocaleDateString();
            const fileSize = (record.fileSize / 1024 / 1024).toFixed(2);
            
            recordCard.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="flex: 1;">
                        <div style="font-weight: bold; margin-bottom: 5px; color: #333;">
                            📄 ${record.title}
                        </div>
                        <div style="font-size: 14px; color: #666; margin-bottom: 5px;">
                            업로드일: ${uploadDate}
                        </div>
                        <div style="font-size: 12px; color: #888;">
                            파일크기: ${fileSize}MB
                        </div>
                        ${record.description ? `<div style="font-size: 13px; color: #555; margin-top: 8px; padding: 8px; background: #f8f9fa; border-radius: 4px;">${record.description}</div>` : ''}
                    </div>
                    <div style="text-align: center; margin-left: 15px;">
                        <button class="btn" style="width: auto; padding: 8px 16px; font-size: 14px;" onclick="downloadMedicalRecord('${record.downloadURL}', '${record.fileName}')">
                            📥 다운로드
                        </button>
                    </div>
                </div>
            `;
            
            recordsList.appendChild(recordCard);
        }
        
    } catch (error) {
        console.error('진료기록부 로드 오류:', error);
        recordsList.innerHTML = '<p style="text-align: center; color: #dc3545;">진료기록부 로드 중 오류가 발생했습니다.</p>';
    }
}

// 파일 다운로드
function downloadMedicalRecord(downloadURL, fileName) {
    try {
        const link = document.createElement('a');
        link.href = downloadURL;
        link.download = fileName;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (error) {
        console.error('다운로드 오류:', error);
        alert('파일 다운로드 중 오류가 발생했습니다.');
    }
}

// 복약 지도 모니터링 로딩 함수
async function loadMedicationGuide() {
    const guideList = document.getElementById('medicationGuideList');
    if (!guideList) return;
    
    guideList.innerHTML = '<div class="loading" style="text-align: center;">환자 복약 현황을 불러오는 중...</div>';
    
    try {
        const today = new Date().toISOString().split('T')[0];
        
        // 1. 먼저 현재 의사가 직접 관리하는 환자들만 가져오기
        const doctorPatientsSnapshot = await database.ref(`doctorPatients/${currentUser.uid}`).once('value');
        const directPatients = Object.keys(doctorPatientsSnapshot.val() || {});
        
        // 2. 현재 의사가 처방한 환자들만 가져오기
        const prescriptionsSnapshot = await database.ref('prescriptions').once('value');
        const allPrescriptions = prescriptionsSnapshot.val() || {};
        
        let prescriptionPatients = [];
        Object.entries(allPrescriptions).forEach(([patientId, patientPrescriptions]) => {
            // 현재 의사가 처방한 활성 처방전만 확인
            const myActivePrescriptions = Object.values(patientPrescriptions).filter(p => 
                p.prescribedById === currentUser.uid && 
                p.isActive && 
                today >= p.startDate && 
                today <= p.endDate
            );
            if (myActivePrescriptions.length > 0) {
                prescriptionPatients.push(patientId);
            }
        });
        
        // 3. 현재 의사와 연결된 환자들만 (중복 제거)
        const managedPatients = [...new Set([...directPatients, ...prescriptionPatients])];
        
        if (managedPatients.length === 0) {
            guideList.innerHTML = '<p style="text-align: center; color: #666;">관리 중인 환자가 없습니다.</p>';
            return;
        }
        
        // 사용자 정보 가져오기
        const usersSnapshot = await database.ref('users').once('value');
        const users = usersSnapshot.val() || {};
        
        // 부작용 신고 확인 (현재 의사에게 온 것만)
        const sideEffectReports = await getSideEffectReports();
        
        let patientsData = [];
        
        // 현재 의사가 관리하는 환자들만 분석
        for (const patientId of managedPatients) {
            const patient = users[patientId];
            if (!patient || patient.userType !== 'patient') continue;
            
            const patientPrescriptions = allPrescriptions[patientId] || {};
            const activePrescriptions = Object.values(patientPrescriptions).filter(p => 
                p.prescribedById === currentUser.uid &&  // 현재 의사가 처방한 것만
                p.isActive && 
                today >= p.startDate && 
                today <= p.endDate
            );
            
            if (activePrescriptions.length > 0) {
                // 오늘 복약 기록 확인
                const adherenceSnapshot = await database.ref(`adherence/${patientId}/${today}`).once('value');
                const todayAdherence = adherenceSnapshot.val() || {};
                
                let totalRequired = 0;
                let taken = 0;
                
                activePrescriptions.forEach(prescription => {
                    totalRequired += prescription.times.length;
                    const prescriptionKey = Object.keys(patientPrescriptions).find(key => 
                        patientPrescriptions[key] === prescription
                    );
                    
                    if (todayAdherence[prescriptionKey]) {
                        taken += Object.keys(todayAdherence[prescriptionKey] || {}).length;
                    }
                });
                
                const hasSideEffectReport = sideEffectReports.some(report => report.patientId === patientId);
                
                patientsData.push({
                    id: patientId,
                    name: patient.name,
                    totalRequired,
                    taken,
                    adherenceRate: totalRequired > 0 ? Math.round((taken / totalRequired) * 100) : 0,
                    hasSideEffectReport
                });
            }
        }
        
        // 결과 표시
        guideList.innerHTML = '';
        
        if (patientsData.length === 0) {
            guideList.innerHTML = '<p style="text-align: center; color: #666;">관리 중인 환자가 없습니다.</p>';
            return;
        }
        
        // 부작용 신고가 있는 환자들 먼저 표시
        const sideEffectPatients = patientsData.filter(p => p.hasSideEffectReport);
        const regularPatients = patientsData.filter(p => !p.hasSideEffectReport);
        
        // 부작용 신고 섹션
        if (sideEffectPatients.length > 0) {
            const sideEffectHeader = document.createElement('div');
            sideEffectHeader.style.cssText = `
                background: #dc3545;
                color: white;
                padding: 12px 15px;
                margin-bottom: 15px;
                border-radius: 8px;
                font-weight: bold;
                font-size: 16px;
            `;
            sideEffectHeader.innerHTML = `⚠️ 부작용 신고 환자 (${sideEffectPatients.length}명)`;
            guideList.appendChild(sideEffectHeader);
            
            for (const patient of sideEffectPatients) {
                const reports = sideEffectReports.filter(r => r.patientId === patient.id);
                const patientCard = await createSideEffectPatientCard(patient, reports);
                guideList.appendChild(patientCard);
            }
        }
        
        // 일반 복약 관리 섹션
        if (regularPatients.length > 0) {
            const regularHeader = document.createElement('div');
            regularHeader.style.cssText = `
                background: #f8f9fa;
                color: #333;
                padding: 12px 15px;
                margin: 20px 0 15px 0;
                border-radius: 8px;
                font-weight: bold;
                font-size: 16px;
                border-left: 4px solid #2175f4;
            `;
            regularHeader.innerHTML = `📊 일반 복약 관리 (${regularPatients.length}명)`;
            guideList.appendChild(regularHeader);
            
            regularPatients.forEach(patient => {
                const patientCard = createRegularPatientCard(patient);
                guideList.appendChild(patientCard);
            });
        }
        
        // 알림 업데이트
        updateMedicationAlerts(patientsData, sideEffectPatients.length);
        
    } catch (error) {
        console.error('복약 지도 로드 오류:', error);
        guideList.innerHTML = '<p style="text-align: center; color: #dc3545;">데이터 로드 중 오류가 발생했습니다.</p>';
    }
}

// 부작용 신고 데이터 가져오기
async function getSideEffectReports() {
    try {
        const notificationsSnapshot = await database.ref(`notifications/${currentUser.uid}`)
            .orderByChild('type')
            .equalTo('side_effect_report')
            .once('value');
        
        const notifications = notificationsSnapshot.val() || {};
        return Object.values(notifications).filter(n => !n.read);
    } catch (error) {
        console.error('부작용 신고 데이터 로드 오류:', error);
        return [];
    }
}

// 부작용 신고 환자 카드 생성
async function createSideEffectPatientCard(patient, reports) {
    const patientCard = document.createElement('div');
    patientCard.className = 'patient-card';
    patientCard.style.cssText = `
        border: 2px solid #dc3545;
        border-radius: 8px;
        padding: 15px;
        margin-bottom: 15px;
        background: #fff5f5;
        cursor: pointer;
        transition: all 0.2s;
    `;
    
    patientCard.addEventListener('mouseenter', function() {
        this.style.backgroundColor = '#ffe6e6';
    });
    patientCard.addEventListener('mouseleave', function() {
        this.style.backgroundColor = '#fff5f5';
    });
    
    // 가장 최근 부작용 신고 가져오기
    const latestReport = reports.sort((a, b) => b.timestamp - a.timestamp)[0];
    const timeAgo = getTimeAgo(latestReport.timestamp);
    
    patientCard.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <div>
                <div style="font-weight: bold; color: #dc3545; margin-bottom: 5px;">
                    ⚠️ ${patient.name} (부작용 신고)
                </div>
                <div style="font-size: 14px; color: #666;">
                    복약명: ${latestReport.medication} | 신고시간: ${timeAgo}
                </div>
            </div>
            <div style="text-align: center;">
                <div style="font-size: 18px; font-weight: bold; color: #dc3545;">
                    ${patient.adherenceRate}%
                </div>
                <div style="font-size: 12px; color: #666;">순응도</div>
            </div>
        </div>
        <div style="background: white; padding: 10px; border-radius: 5px; border-left: 3px solid #dc3545;">
            <strong>증상:</strong> ${latestReport.sideEffectDescription}
        </div>
        <div style="margin-top: 10px; font-size: 12px; color: #666;">
            복약 현황: ${patient.taken}/${patient.totalRequired}회 완료
        </div>
    `;
    
    patientCard.onclick = () => {
        const confirm = window.confirm(`${patient.name} 환자에게 부작용 관련 상담 메시지를 보내시겠습니까?`);
        if (confirm) {
            sendSideEffectFollowUp(patient.id, patient.name, latestReport);
        }
    };
    
    return patientCard;
}

// 일반 환자 카드 생성
function createRegularPatientCard(patient) {
    const patientCard = document.createElement('div');
    patientCard.className = 'patient-card';

    if (patient.adherenceRate < 100) {
        patientCard.style.cursor = 'pointer';
        patientCard.onclick = () => sendMedicationReminder(patient.id, patient.name);
    }

    patientCard.style.cssText = `
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        padding: 15px;
        margin-bottom: 10px;
        background: white;
        ${patient.adherenceRate < 100 ? 'cursor: pointer; transition: background-color 0.2s;' : ''}
    `;

    if (patient.adherenceRate < 100) {
        patientCard.addEventListener('mouseenter', function() {
            this.style.backgroundColor = '#f8f9fa';
        });
        patientCard.addEventListener('mouseleave', function() {
            this.style.backgroundColor = 'white';
        });
    }
    
    let statusColor = '#28a745'; // 녹색
    if (patient.adherenceRate < 50) statusColor = '#dc3545'; // 빨간색
    else if (patient.adherenceRate < 80) statusColor = '#ffc107'; // 노란색
    
    patientCard.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
                <div style="font-weight: bold; margin-bottom: 5px;">👤 ${patient.name}</div>
                <div style="font-size: 14px; color: #666;">
                    오늘 복약: ${patient.taken}/${patient.totalRequired}회
                </div>
            </div>
            <div style="text-align: center;">
                <div style="font-size: 18px; font-weight: bold; color: ${statusColor};">
                    ${patient.adherenceRate}%
                </div>
                <div style="font-size: 12px; color: #666;">순응도</div>
            </div>
        </div>
    `;
    
    return patientCard;
}

// 부작용 후속 조치 메시지 전송
async function sendSideEffectFollowUp(patientId, patientName, reportData) {
    try {
        showLoading(true);
        
        const followUpMessage = `💊 부작용 관련 상담: ${reportData.medication} 복용 후 느끼신 증상에 대해 추가로 상담이 필요합니다. 현재 상태는 어떠신지 알려주세요. 필요시 처방을 조정하겠습니다.`;
        
        await database.ref(`notifications/${patientId}`).push({
            message: followUpMessage,
            read: false,
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            type: 'side_effect_followup',
            sentBy: currentUser.uid
        });
        
        alert(`${patientName} 환자에게 부작용 후속 상담 메시지가 전송되었습니다.`);
        
        // 원본 부작용 신고를 읽음 처리
        const notificationsSnapshot = await database.ref(`notifications/${currentUser.uid}`)
            .orderByChild('patientId')
            .equalTo(patientId)
            .once('value');
        
        const notifications = notificationsSnapshot.val() || {};
        for (const [notificationId, notification] of Object.entries(notifications)) {
            if (notification.type === 'side_effect_report' && !notification.read) {
                await database.ref(`notifications/${currentUser.uid}/${notificationId}`).update({ read: true });
            }
        }
        
        loadMedicationGuide(); // 화면 새로고침
        
    } catch (error) {
        console.error('후속 조치 메시지 전송 오류:', error);
        alert('메시지 전송 중 오류가 발생했습니다.');
    } finally {
        showLoading(false);
    }
}

// 알림 업데이트
function updateMedicationAlerts(patientsData, sideEffectCount) {
    const alertsEl = document.getElementById('medicationAlerts');
    if (alertsEl) {
        if (sideEffectCount > 0) {
            alertsEl.innerHTML = `🚨 ${sideEffectCount}명의 환자가 부작용을 신고했습니다. 즉시 확인이 필요합니다.`;
            alertsEl.style.color = '#dc3545';
            alertsEl.style.fontWeight = 'bold';
        } else {
            const lowAdherence = patientsData.filter(p => p.adherenceRate < 80);
            if (lowAdherence.length > 0) {
                alertsEl.innerHTML = `⚠️ ${lowAdherence.length}명의 환자가 복약 순응도 개선이 필요합니다.`;
                alertsEl.style.color = '#ffc107';
                alertsEl.style.fontWeight = 'normal';
            } else {
                alertsEl.innerHTML = '✅ 모든 환자가 양호한 복약 상태를 유지하고 있습니다.';
                alertsEl.style.color = '#28a745';
                alertsEl.style.fontWeight = 'normal';
            }
        }
    }
}

// 복약 알림 전송 함수
async function sendMedicationReminder(patientId, patientName) {
    try {
        // 확인 메시지 표시
        const confirmSend = confirm(`${patientName} 환자에게 복약 알림을 보내시겠습니까?`);
        
        if (confirmSend) {
            showLoading(true);
            
            // 오늘 날짜 가져오기
            const today = new Date();
            const timeString = today.toLocaleTimeString('ko-KR', { 
                hour: '2-digit', 
                minute: '2-digit' 
            });
            
            // 알림 메시지 생성
            const reminderMessage = `💊 복약 알림: 처방받은 약을 잊지 말고 복용해주세요. 건강한 회복을 위해 정해진 시간에 복용하는 것이 중요합니다. (${timeString} 알림)`;
            
            // Firebase에 알림 저장
            await database.ref(`notifications/${patientId}`).push({
                message: reminderMessage,
                read: false,
                timestamp: firebase.database.ServerValue.TIMESTAMP,
                type: 'medication_reminder',
                sentBy: currentUser.uid
            });
            
            // 성공 메시지
            alert(`${patientName} 환자에게 복약 알림이 전송되었습니다.`);
            
            // 복약 지도 데이터 새로고침
            loadMedicationGuide();
            
        }
    } catch (error) {
        console.error('복약 알림 전송 오류:', error);
        alert('알림 전송 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
        showLoading(false);
    }
}

// 의료진 일정 관리 로딩 함수
async function loadDoctorSchedule() {
    const scheduleList = document.getElementById('doctorScheduleList');
    if (!scheduleList) return;
    
    scheduleList.innerHTML = '<div class="loading" style="text-align: center;">진료 일정을 불러오는 중...</div>';
    
    try {
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        
        // 앞으로 7일간의 예약 정보 가져오기
        const appointmentsSnapshot = await database.ref('appointments').orderByChild('date').once('value');
        const allAppointments = appointmentsSnapshot.val() || {};
        
        // 사용자 정보 가져오기
        const usersSnapshot = await database.ref('users').once('value');
        const users = usersSnapshot.val() || {};
        
        scheduleList.innerHTML = '';
        
        // 날짜별로 예약 그룹화
        const appointmentsByDate = {};
        let totalTodayAppointments = 0;
        
        Object.entries(allAppointments).forEach(([appointmentId, appointment]) => {
            if (appointment.date >= todayStr) { // 오늘 이후 예약만
                if (!appointmentsByDate[appointment.date]) {
                    appointmentsByDate[appointment.date] = [];
                }
                appointmentsByDate[appointment.date].push({
                    id: appointmentId,
                    ...appointment
                });
                
                // 오늘 예약 수 계산
                if (appointment.date === todayStr) {
                    totalTodayAppointments++;
                }
            }
        });
        
        // 오늘 예약 수 업데이트
        const countEl = document.getElementById('todayAppointmentCount');
        if (countEl) {
            countEl.textContent = `오늘 예약된 환자: ${totalTodayAppointments}명`;
        }
        
        // 날짜별로 정렬된 키 생성 (앞으로 7일간)
        const dates = [];
        for (let i = 0; i < 7; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() + i);
            dates.push(date.toISOString().split('T')[0]);
        }
        
        let hasAnyAppointments = false;
        
        dates.forEach(dateStr => {
            const dateObj = new Date(dateStr);
            const dayOfWeek = ['일', '월', '화', '수', '목', '금', '토'][dateObj.getDay()];
            const isToday = dateStr === todayStr;
            
            // 날짜 헤더 생성
            const dateHeader = document.createElement('div');
            dateHeader.style.cssText = `
                background: ${isToday ? '#2175f4' : '#f8f9fa'};
                color: ${isToday ? 'white' : '#333'};
                padding: 10px 15px;
                margin: 15px 0 10px 0;
                border-radius: 8px;
                font-weight: bold;
                font-size: 16px;
            `;
            dateHeader.innerHTML = `
                📅 ${dateObj.getFullYear()}년 ${dateObj.getMonth() + 1}월 ${dateObj.getDate()}일 (${dayOfWeek})
                ${isToday ? ' - 오늘' : ''}
            `;
            scheduleList.appendChild(dateHeader);
            
            // 해당 날짜의 예약 표시
            if (appointmentsByDate[dateStr]) {
                hasAnyAppointments = true;
                
                // 시간순 정렬
                const sortedAppointments = appointmentsByDate[dateStr].sort((a, b) => 
                    a.time.localeCompare(b.time)
                );
                
                sortedAppointments.forEach(appointment => {
                    const patient = users[appointment.patientId];
                    const appointmentCard = document.createElement('div');
                    appointmentCard.className = 'patient-card';
                    appointmentCard.style.cssText = `
                        border: 1px solid #e0e0e0;
                        border-radius: 8px;
                        padding: 15px;
                        margin-bottom: 10px;
                        background: white;
                        margin-left: 20px;
                        ${isToday ? 'border-left: 4px solid #2175f4;' : ''}
                    `;
                    
                    appointmentCard.innerHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div style="font-weight: bold; margin-bottom: 5px; color: #333;">
                                    👤 ${patient ? patient.name : '알 수 없는 환자'}
                                </div>
                                
                                <div style="font-size: 12px; color: #888;">
                                    예약일시: ${dateObj.getMonth() + 1}/${dateObj.getDate()} ${appointment.time}
                                </div>
                            </div>
                            <div style="text-align: center;">
                                <div style="font-size: 20px; font-weight: bold; color: #2175f4;">
                                    ${appointment.time}
                                </div>
                                <div style="font-size: 12px; color: #666;">예약 시간</div>
                                ${appointment.status ? `<div style="font-size: 11px; color: #28a745; margin-top: 3px;">${appointment.status === 'scheduled' ? '예약됨' : appointment.status}</div>` : ''}
                            </div>
                        </div>
                    `;
                    
                    scheduleList.appendChild(appointmentCard);
                });
            } else {
                // 예약이 없는 날
                const noAppointmentDiv = document.createElement('div');
                noAppointmentDiv.style.cssText = `
                    padding: 15px;
                    margin-bottom: 10px;
                    margin-left: 20px;
                    text-align: center;
                    color: #999;
                    font-style: italic;
                    background: #f9f9f9;
                    border-radius: 5px;
                `;
                noAppointmentDiv.textContent = '예약된 환자가 없습니다.';
                scheduleList.appendChild(noAppointmentDiv);
            }
        });
        
        if (!hasAnyAppointments) {
            const noAppointmentsMsg = document.createElement('div');
            noAppointmentsMsg.style.cssText = `
                text-align: center;
                color: #666;
                padding: 20px;
                font-size: 16px;
            `;
            noAppointmentsMsg.innerHTML = '📅 앞으로 7일간 예약된 환자가 없습니다.';
            scheduleList.appendChild(noAppointmentsMsg);
        }
        
    } catch (error) {
        console.error('진료 일정 로드 오류:', error);
        scheduleList.innerHTML = '<p style="text-align: center; color: #dc3545;">일정 로드 중 오류가 발생했습니다.</p>';
    }
}

// --- 환자 기능 ---
async function loadPatientMedicationSchedule() {
    const scheduleEl = document.getElementById('todayMedicationSchedule');
    scheduleEl.innerHTML = '';
    const todayStr = new Date().toISOString().split('T')[0];
    try {
        const prescriptionsSnapshot = await database.ref(`prescriptions/${currentUser.uid}`).orderByChild('isActive').equalTo(true).once('value');
        const allPrescriptions = prescriptionsSnapshot.val() || {};
        const todayPrescriptions = Object.entries(allPrescriptions).filter(([, p]) => todayStr >= p.startDate && todayStr <= p.endDate);
        const adherenceSnapshot = await database.ref(`adherence/${currentUser.uid}/${todayStr}`).once('value');
        const todayAdherence = adherenceSnapshot.val() || {};

        if (todayPrescriptions.length === 0) {
            scheduleEl.innerHTML = '<p style="text-align:center; color:#888; padding: 10px 0;">오늘 처방된 약이 없습니다.</p>';
        } else {
            renderTodayScheduleUI(todayPrescriptions, todayAdherence);
        }
        renderCalendarView();
    } catch (error) { console.error("복약 일정 로드 에러:", error); }
}

function renderTodayScheduleUI(prescriptions, adherence) {
    const scheduleEl = document.getElementById('todayMedicationSchedule');
    scheduleEl.innerHTML = '';
    const timeSlots = ['아침', '점심', '저녁', '취침 전'];
    let contentRendered = false;
    timeSlots.forEach(time => {
        const medsForTime = prescriptions.filter(([, p]) => p.times.includes(time));
        if (medsForTime.length > 0) {
            contentRendered = true;
            let medsHtml = `<div class="medication-item"><h4>${time} (처방)</h4>`;
            medsForTime.forEach(([id, p]) => {
                const takenInfo = adherence[id] && adherence[id][time];
                medsHtml += `
                    <div class="medication-header">
                        <div class="medication-name">${p.medName} (${p.dosage})</div>
                        <button class="take-btn" ${takenInfo ? 'disabled' : ''} onclick="markMedicationAsTaken('${id}', '${time}')">${takenInfo ? '복용완료' : '복용하기'}</button>
                    </div>
                    ${p.instructions ? `<p style="font-size:12px; color:#666;">- ${p.instructions}</p>` : ''}
                    ${takenInfo ? `
                        <div style="margin-top: 10px; font-size: 14px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                            <span>부작용 여부:</span>
                            <button class="btn btn-sm ${takenInfo.sideEffect === false ? 'btn-success' : ''}" style="width:auto; padding: 5px 10px; font-size: 12px;" onclick="reportSideEffects('${id}', '${time}', false)">정상</button>
                            <button class="btn btn-sm ${takenInfo.sideEffect === true ? 'btn-danger' : ''}" style="width:auto; padding: 5px 10px; font-size: 12px; background-color: ${takenInfo.sideEffect === true ? '#dc3545' : '#6c757d'};" onclick="showSideEffectInput('${id}', '${time}', '${p.medName}')">부작용</button>
                        </div>
                        ${takenInfo.sideEffect === true && takenInfo.sideEffectDescription ? `
                            <div style="margin-top: 8px; padding: 8px; background: #fff3cd; border-left: 3px solid #ffc107; border-radius: 4px;">
                                <strong>부작용 증상:</strong> ${takenInfo.sideEffectDescription}
                            </div>
                        ` : ''}
                    ` : ''}`;
            });
            medsHtml += '</div>';
            scheduleEl.innerHTML += medsHtml;
        }
    });
    if (!contentRendered) scheduleEl.innerHTML = '<p style="text-align:center; color:#888; padding: 10px 0;">오늘 처방된 약이 없습니다.</p>';
}

// 부작용 입력창 표시 함수
function showSideEffectInput(prescriptionId, time, medName) {
    const sideEffectDescription = prompt(`${medName} 복용 후 어떤 부작용인 것 같나요?\n\n증상을 자세히 입력해주세요:`);
    
    if (sideEffectDescription && sideEffectDescription.trim()) {
        reportSideEffectsWithDescription(prescriptionId, time, true, sideEffectDescription.trim(), medName);
    }
}

// 부작용 보고 함수 (설명 포함)
async function reportSideEffectsWithDescription(prescriptionId, time, hasSideEffects, description, medName) {
    const todayStr = new Date().toISOString().split('T')[0];
    try {
        showLoading(true);
        
        // 부작용 정보 저장
        await database.ref(`adherence/${currentUser.uid}/${todayStr}/${prescriptionId}/${time}`).update({
            sideEffect: hasSideEffects,
            sideEffectDescription: description || null,
            sideEffectReportedAt: firebase.database.ServerValue.TIMESTAMP
        });
        
        if (hasSideEffects && description) {
            // 환자 정보 가져오기
            const userSnapshot = await database.ref(`users/${currentUser.uid}`).once('value');
            const userData = userSnapshot.val();
            const patientName = userData ? userData.name : '환자';
            
            // 처방한 의사 정보 가져오기
            const prescriptionSnapshot = await database.ref(`prescriptions/${currentUser.uid}/${prescriptionId}`).once('value');
            const prescriptionData = prescriptionSnapshot.val();
            
            if (prescriptionData && prescriptionData.prescribedById) {
                // 의사에게 알림 전송
                const alertMessage = `[부작용 신고] ${patientName} 환자가 '${medName}' 복용 후 부작용을 호소하고 있습니다. 증상: ${description}`;
                
                await database.ref(`notifications/${prescriptionData.prescribedById}`).push({
                    message: alertMessage,
                    read: false,
                    timestamp: firebase.database.ServerValue.TIMESTAMP,
                    type: 'side_effect_report',
                    patientId: currentUser.uid,
                    patientName: patientName,
                    medication: medName,
                    sideEffectDescription: description,
                    prescriptionId: prescriptionId,
                    medicationTime: time
                });
                
                alert('부작용이 신고되었습니다. 담당 의료진에게 알림이 전송되었습니다.');
            } else {
                alert('부작용이 기록되었습니다.');
            }
        }
        
        loadPatientMedicationSchedule();
    } catch (error) { 
        console.error("부작용 보고 에러:", error);
        alert('부작용 신고 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
        showLoading(false);
    }
}

async function markMedicationAsTaken(prescriptionId, time) {
    const todayStr = new Date().toISOString().split('T')[0];
    try {
        await database.ref(`adherence/${currentUser.uid}/${todayStr}/${prescriptionId}/${time}`).set({ taken: true, timestamp: firebase.database.ServerValue.TIMESTAMP, sideEffect: null });
        loadPatientMedicationSchedule();
    } catch (error) { console.error("복용 기록 저장 에러:", error); }
}

async function reportSideEffects(prescriptionId, time, hasSideEffects) {
    const todayStr = new Date().toISOString().split('T')[0];
    try {
        await database.ref(`adherence/${currentUser.uid}/${todayStr}/${prescriptionId}/${time}/sideEffect`).set(hasSideEffects);
        
        // 정상인 경우 부작용 설명 제거
        if (!hasSideEffects) {
            await database.ref(`adherence/${currentUser.uid}/${todayStr}/${prescriptionId}/${time}/sideEffectDescription`).remove();
        }
        
        loadPatientMedicationSchedule();
    } catch (error) { 
        console.error("부작용 보고 에러:", error); 
    }
}

async function renderCalendarView() {
    const calendarEl = document.getElementById('medicationCalendarView');
    calendarEl.innerHTML = '';
    for (let i = 6; i >= 0; i--) {
        const date = new Date(new Date().setDate(new Date().getDate() - i));
        const dateStr = date.toISOString().split('T')[0];
        const dayOfWeek = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
        const { total, taken } = await getAdherenceForDate(dateStr);
        let color = total > 0 ? (taken / total === 1 ? '#d4edda' : (taken > 0 ? '#fff3cd' : '#f8d7da')) : '#f0f0f0';
        calendarEl.innerHTML += `<div style="padding: 5px; border-radius: 5px; background-color: ${color};"><div style="font-size: 12px;">${dayOfWeek}</div><div style="font-weight: bold;">${date.getDate()}</div><div style="font-size: 11px;">${taken}/${total}</div></div>`;
    }
}

async function getAdherenceForDate(dateStr) {
    const snapshot = await database.ref(`prescriptions/${currentUser.uid}`).orderByChild('isActive').equalTo(true).once('value');
    const prescriptions = Object.values(snapshot.val() || {}).filter(p => dateStr >= p.startDate && dateStr <= p.endDate);
    let total = 0;
    prescriptions.forEach(p => total += p.times.length);
    const adherenceSnapshot = await database.ref(`adherence/${currentUser.uid}/${dateStr}`).once('value');
    const adherenceData = adherenceSnapshot.val() || {};
    let taken = 0;
    Object.values(adherenceData).forEach(p => taken += Object.keys(p).length);
    return { total, taken };
}

function addMedication() {
    const name = prompt('약물명을 입력하세요:');
    const time = prompt('복용시간을 입력하세요 (예: 08:00):');
    const dosage = prompt('용량을 입력하세요 (예: 1정):');
    if (name && time && dosage) {
        database.ref('medications/' + currentUser.uid).push({ name, time, dosage, taken: false, createdAt: new Date().toISOString() })
            .then(() => { loadMedications(); alert('약물이 추가되었습니다.'); })
            .catch(e => console.error(e));
    }
}

async function loadMedications() {
    if (!currentUser) return;
    const medicationList = document.getElementById('medicationList');
    medicationList.innerHTML = '';
    try {
        const snapshot = await database.ref('medications/' + currentUser.uid).once('value');
        const medications = snapshot.val() || {};
        if (Object.keys(medications).length > 0) {
            let header = medicationList.querySelector('h4');
            if (!header) {
                header = document.createElement('h4');
                header.textContent = "직접 추가한 약";
                header.style.marginTop = '20px';
                medicationList.appendChild(header);
            }
        }
        Object.entries(medications).forEach(([id, med]) => {
            const medicationDiv = document.createElement('div');
            medicationDiv.className = `medication-item ${med.taken ? 'taken' : ''}`;
            medicationDiv.innerHTML = `<div class="medication-header"><div class="medication-name">${med.name}</div><button class="take-btn" ${med.taken ? 'disabled' : ''} onclick="takeMedication('${id}')">${med.taken ? '복용완료' : '복용하기'}</button></div><div style="font-size: 14px; color: #666;">복용시간: ${med.time} | 용량: ${med.dosage}</div>`;
            medicationList.appendChild(medicationDiv);
        });
    } catch (error) { console.error('복약 정보 로드 에러:', error); }
}

async function takeMedication(medicationId) {
    try {
        await database.ref(`medications/${currentUser.uid}/${medicationId}/taken`).set(true);
        loadMedications();
    } catch (error) { console.error('복약 처리 에러:', error); }
}

// =============================================
// ### 공통 기능 (채팅, 예약, Q&A) - 수정됨 ###
// =============================================

// 메시지 전송 함수 (중복 전송 방지 추가)
async function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    
    if (!message || !currentUser) return;
    
    const sendBtn = document.querySelector('.send-btn');
    if (sendBtn.disabled) return;
    
    try {
        sendBtn.disabled = true;
        
        const messageData = { 
            text: message, 
            senderId: currentUser.uid, 
            senderType: currentUserType, 
            timestamp: firebase.database.ServerValue.TIMESTAMP 
        };
        
        // 환자인 경우 의료진에게 보내는 메시지로 설정
        if (currentUserType === 'patient') {
            messageData.forDoctors = true; // 의료진용 메시지 표시
        } else if (currentUserType === 'doctor' && currentChatPatientId) {
            messageData.recipientId = currentChatPatientId;
        }
        
        await database.ref('messages').push(messageData);
        input.value = '';
        
    } catch (error) { 
        console.error('메시지 전송 에러:', error);
        alert('메시지 전송에 실패했습니다. 다시 시도해주세요.');
    } finally {
        setTimeout(() => {
            sendBtn.disabled = false;
        }, 500);
    }
}

// 채팅 메시지 로드 함수 (중복 리스너 방지)
function loadChatMessages() {
    if (isChatListenerActive) {
        console.log('채팅 리스너가 이미 활성화되어 있습니다.');
        return;
    }
    
    if (chatMessagesListener) {
        chatMessagesListener.off();
        chatMessagesListener = null;
    }
    
    const messagesContainer = document.getElementById('chatMessages');
    if (messagesContainer) {
        messagesContainer.innerHTML = '';
    }
    
    // 환자는 본인 관련 메시지만 로드
    if (currentUserType === 'patient') {
        const messagesRef = database.ref('messages')
            .orderByChild('timestamp')
            .limitToLast(50);
        
        chatMessagesListener = messagesRef;
        isChatListenerActive = true;
        
        messagesRef.once('value', (snapshot) => {
            const messages = snapshot.val() || {};
            const patientMessages = Object.entries(messages)
                .filter(([, message]) => {
                    // 환자 자신이 보낸 메시지이거나, 환자에게 온 메시지만
                    return (message.senderId === currentUser.uid) || 
                           (message.recipientId === currentUser.uid) ||
                           (message.senderType === 'doctor' && !message.recipientId); // 일반 의료진 메시지
                })
                .sort(([,a], [,b]) => a.timestamp - a.timestamp);
            
            if (patientMessages.length > 0) {
                lastLoadedMessageTimestamp = patientMessages[patientMessages.length - 1][1].timestamp;
            }
            
            patientMessages.forEach(([, message]) => {
                displayMessage(message);
            });
            
            setTimeout(() => {
                messagesRef.on('child_added', (snapshot) => {
                    const message = snapshot.val();
                    
                    if (lastLoadedMessageTimestamp && message.timestamp <= lastLoadedMessageTimestamp) {
                        return;
                    }
                    
                    // 환자 관련 메시지만 표시
                    if ((message.senderId === currentUser.uid) || 
                        (message.recipientId === currentUser.uid) ||
                        (message.senderType === 'doctor' && !message.recipientId)) {
                        displayMessage(message);
                    }
                });
            }, 100);
        });
    }
}

function displayMessage(message) {
    const messagesContainer = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.senderId === currentUser.uid ? 'sent' : ''}`;
    const time = new Date(message.timestamp).toLocaleTimeString();
    messageDiv.innerHTML = `<div class="message-bubble">${message.text}<div class="message-meta">${time}</div></div>`;
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function selectTimeSlot(element, time) {
    document.querySelectorAll('.time-slot').forEach(slot => slot.classList.remove('selected'));
    element.classList.add('selected');
    selectedTimeSlot = time;
}

async function makeAppointment() {
    const date = document.getElementById('appointmentDate').value;
    if (!date || !selectedTimeSlot) return alert('날짜와 시간을 선택해주세요.');
    try {
        await database.ref('appointments').push({ patientId: currentUser.uid, date, time: selectedTimeSlot, status: 'scheduled', createdAt: new Date().toISOString() });
        alert('예약이 완료되었습니다.');
    } catch (error) { console.error('예약 에러:', error); }
}

async function loadQnA() {
    const qnaList = document.getElementById('qnaList');
    if (!qnaList) {
        console.error('qnaList 요소를 찾을 수 없습니다.');
        return;
    }

    // 로딩 상태 표시
    qnaList.innerHTML = '<div class="loading" style="display:block; text-align:center; padding: 20px;">Q&A 목록을 불러오는 중...</div>';
    
    try {
        console.log('Q&A 데이터 로딩 시작...');
        const snapshot = await database.ref('qna').once('value');
        const qnaData = snapshot.val() || {};
        
        console.log('Q&A 데이터:', qnaData);
        console.log('Q&A 데이터 개수:', Object.keys(qnaData).length);

        // 로딩 표시 제거
        qnaList.innerHTML = '';
        
        if (Object.keys(qnaData).length === 0) {
            qnaList.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">등록된 질문이 없습니다.</p>';
            return;
        }

        // 날짜 기준으로 정렬 (최신순)
        const sortedQnA = Object.entries(qnaData).sort(([, a], [, b]) => {
            const dateA = new Date(a.createdAt || 0);
            const dateB = new Date(b.createdAt || 0);
            return dateB - dateA;
        });

        console.log('정렬된 Q&A:', sortedQnA.length, '개');

        // Q&A 카드 생성
        for (const [qnaId, qa] of sortedQnA) {
            try {
                // 질문자 정보 가져오기
                const askerSnapshot = await database.ref(`users/${qa.askerId}`).once('value');
                const asker = askerSnapshot.val();
                const askerName = asker ? `${asker.name[0]}**` : '익명';

                const qnaCard = document.createElement('div');
                qnaCard.className = `qna-card ${!qa.answer ? 'unanswered' : ''}`;
                qnaCard.style.cssText = `
                    border: 1px solid #e0e0e0;
                    border-radius: 8px;
                    padding: 15px;
                    margin-bottom: 15px;
                    background: white;
                `;

                // 답변 상태에 따른 스타일
                if (!qa.answer) {
                    qnaCard.style.borderLeft = '4px solid #ffc107';
                } else {
                    qnaCard.style.borderLeft = '4px solid #28a745';
                }

                qnaCard.innerHTML = `
                    <div style="font-weight: bold; margin-bottom: 10px; font-size: 16px;">
                        <span style="color: #2175f4;">Q.</span> ${qa.question}
                    </div>
                    <div style="font-size: 12px; color: #888; margin-bottom: 15px;">
                        <span>질문자: ${askerName}</span> | 
                        <span>${new Date(qa.createdAt).toLocaleDateString()}</span>
                        ${qa.askerId === currentUser.uid ? ' | <span style="color: #2175f4; font-weight: bold;">내 질문</span>' : ''}
                    </div>
                    ${qa.answer ? 
                        `<div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-top: 10px;">
                            <strong style="color: #28a745;">A.</strong> ${qa.answer}
                            ${qa.answeredAt ? `<div style="font-size: 12px; color: #666; margin-top: 5px;">답변일: ${new Date(qa.answeredAt).toLocaleDateString()}</div>` : ''}
                        </div>` : 
                        `<div style="color: #6c757d; font-size: 14px; font-style: italic;">답변 대기 중입니다.</div>`
                    }
                `;
                qnaList.appendChild(qnaCard);
            } catch (cardError) {
                console.error('Q&A 카드 생성 오류:', cardError);
            }
        }

        console.log('Q&A 로딩 완료');
        
    } catch (error) {
        console.error('Q&A 로드 에러:', error);
        qnaList.innerHTML = `
            <div style="text-align: center; color: #dc3545; padding: 20px;">
                <p>Q&A 목록을 불러오는 중 오류가 발생했습니다.</p>
                <p style="font-size: 12px;">오류: ${error.message}</p>
                <button class="btn btn-secondary" onclick="loadQnA()" style="margin-top: 10px;">다시 시도</button>
            </div>
        `;
    }
}

function askQuestion() {
    const question = prompt('질문을 입력하세요:');
    if (question && question.trim()) {
        showLoading(true);
        database.ref('qna').push({
            question: question.trim(),
            askerId: currentUser.uid,
            askerType: currentUserType,
            answer: null,
            createdAt: new Date().toISOString()
        })
        .then(() => {
            showLoading(false);
            alert('질문이 등록되었습니다.');
            loadQnA(); // 질문 등록 후 목록 새로고침
        })
        .catch(error => {
            showLoading(false);
            console.error('질문 등록 오류:', error);
            alert('질문 등록 중 오류가 발생했습니다. 다시 시도해주세요.');
        });
    }
}

// =============================================
// ### 의료진 전용 기능 ###
// =============================================

async function loadDoctorChatList() {
    const chatListContainer = document.getElementById('patientChatList');
    chatListContainer.innerHTML = '';
    try {
        const snapshot = await database.ref('users').orderByChild('userType').equalTo('patient').once('value');
        const patients = snapshot.val() || {};
        Object.entries(patients).forEach(([patientId, patient]) => {
            const patientCard = document.createElement('div');
            patientCard.className = 'patient-card';
            patientCard.onclick = () => openPatientChat(patientId, patient.name);
            patientCard.innerHTML = `<div class="patient-info"><div class="patient-name">👤 ${patient.name}</div><div class="patient-status">상담 가능</div></div>`;
            chatListContainer.appendChild(patientCard);
        });
    } catch (e) { console.error(e); }
}

function openPatientChat(patientId, patientName) {
    currentChatPatientId = patientId;
    document.getElementById('chatTitle').textContent = `${patientName}님과의 상담`;
    loadPatientSpecificMessages(patientId);
    showScreen('chatScreen');
}

// 환자 전용 채팅 메시지 로드 (의료진용) - 수정됨
function loadPatientSpecificMessages(patientId) {
    // 기존 리스너 정리
    clearChatListeners();
    
    const messagesContainer = document.getElementById('chatMessages');
    if (messagesContainer) {
        messagesContainer.innerHTML = '';
    }
    
    const messagesRef = database.ref('messages').orderByChild('timestamp').limitToLast(100);
    chatMessagesListener = messagesRef;
    isChatListenerActive = true;
    
    // 기존 메시지 로드
    messagesRef.once('value', (snapshot) => {
        const messages = snapshot.val() || {};
        const filteredMessages = Object.entries(messages)
            .filter(([, message]) => {
                return (message.senderId === currentUser.uid && message.recipientId === patientId) || 
                       (message.senderId === patientId && (message.recipientId === currentUser.uid || !message.recipientId));
            })
            .sort(([,a], [,b]) => a.timestamp - b.timestamp);
        
        // 마지막 메시지의 타임스탬프 기억
        if (filteredMessages.length > 0) {
            lastLoadedMessageTimestamp = filteredMessages[filteredMessages.length - 1][1].timestamp;
        }
        
        filteredMessages.forEach(([, message]) => {
            displayMessage(message);
        });
        
        // 기존 메시지 로드 완료 후 실시간 리스너 등록 (약간의 지연)
        setTimeout(() => {
            messagesRef.on('child_added', (snapshot) => {
                const message = snapshot.val();
                
                // 이미 로드된 메시지는 건너뛰기
                if (lastLoadedMessageTimestamp && message.timestamp <= lastLoadedMessageTimestamp) {
                    return;
                }
                
                // 환자별 필터링 적용
                if ((message.senderId === currentUser.uid && message.recipientId === patientId) || 
                    (message.senderId === patientId && (message.recipientId === currentUser.uid || !message.recipientId))) {
                    displayMessage(message);
                }
            });
        }, 100); // 100ms 지연
    });
}

async function loadDoctorQnA() {
    const qnaContainer = document.getElementById('doctorQnaList');
    qnaContainer.innerHTML = '';
    try {
        const snapshot = await database.ref('qna').once('value');
        const qnaData = snapshot.val() || {};
        if (Object.keys(qnaData).length === 0) return qnaContainer.innerHTML = '<p style="text-align: center; color: #666;">등록된 질문이 없습니다.</p>';
        const sortedQnA = Object.entries(qnaData).sort(([, a], [, b]) => (!a.answer && b.answer) ? -1 : (a.answer && !b.answer) ? 1 : new Date(b.createdAt) - new Date(a.createdAt));
        for (const [qnaId, qa] of sortedQnA) {
            const askerSnapshot = await database.ref(`users/${qa.askerId}`).once('value');
            const asker = askerSnapshot.val();
            const qnaCard = document.createElement('div');
            qnaCard.className = `qna-card ${!qa.answer ? 'unanswered' : ''}`;
            qnaCard.innerHTML = `
                <div style="font-weight: bold; margin-bottom: 10px;">${!qa.answer ? '🔴' : '✅'} Q: ${qa.question}</div>
                <div style="font-size: 14px; color: #666; margin-bottom: 10px;">질문자: ${asker ? asker.name : '알 수 없음'} | ${new Date(qa.createdAt).toLocaleDateString()}</div>
                ${qa.answer ? `<div style="background: #f8f9fa; padding: 10px; border-radius: 8px;"><strong>A:</strong> ${qa.answer}</div>` :
                `<textarea class="form-group" style="width: 100%;" placeholder="답변을 입력하세요..." id="answer-${qnaId}"></textarea>
                 <button class="btn" onclick="submitAnswer('${qnaId}')" style="margin-top: 10px; width: auto; padding: 8px 16px;">답변 등록</button>`}
            `;
            qnaContainer.appendChild(qnaCard);
        }
    } catch (error) { console.error('Q&A 관리 로드 에러:', error); }
}

async function submitAnswer(qnaId) {
    const answerText = document.getElementById(`answer-${qnaId}`).value.trim();
    if (!answerText) return alert('답변을 입력해주세요.');
    try {
        await database.ref(`qna/${qnaId}`).update({ answer: answerText, answeredBy: currentUser.uid, answeredAt: new Date().toISOString() });
        alert('답변이 등록되었습니다.');
        loadDoctorQnA();
    } catch (error) { console.error('답변 등록 에러:', error); }
}

// =============================================
// ### 유틸리티 및 헬퍼 함수 ###
// =============================================

// 뒤로가기 함수 수정 (리스너 정리 추가)
function goBack() {
    const activeScreen = document.querySelector('.screen.active').id;
    
    // 채팅 관련 리스너 정리
    clearChatListeners();
    
    if (activeScreen === 'prescriptionScreen') {
        showScreen('patientManagementScreen');
        return;
    }
    
    if (activeScreen === 'uploadMedicalRecordScreen') {
        showScreen('patientManagementScreen');
        return;
    }

    if (activeScreen === 'familyVerificationScreen') {
        resetVerificationForm();
    }
    
    if (currentUserType === 'patient') {
        showScreen('patientDashboard');
    } else if (currentUserType === 'guardian') {
    showScreen('guardianDashboard')
    }
    else {
        showScreen('doctorDashboard');
    }
    
    currentChatPatientId = null;
    document.getElementById('chatTitle').textContent = '상담실';
}

function showLogin() { showScreen('loginScreen'); }
function showSignup() { showScreen('signupScreen'); }

// Enter 키 처리 함수 (이벤트 중복 방지)
function handleEnter(event) {
    if (event.key === 'Enter') {
        event.preventDefault(); // 폼 제출 방지
        sendMessage();
    }
}

function showLoading(show) { document.getElementById('loading').style.display = show ? 'block' : 'none'; }
function showError(elementId, message) {
    const errorElement = document.getElementById(elementId);
    errorElement.textContent = message;
    errorElement.style.display = 'block';
    setTimeout(() => { errorElement.style.display = 'none'; }, 5000);
}
function showSuccess(elementId, message) {
    const successElement = document.getElementById(elementId);
    successElement.textContent = message;
    successElement.style.display = 'block';
    setTimeout(() => { successElement.style.display = 'none'; }, 3000);
}
function clearForms() {
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('signupName').value = '';
    document.getElementById('signupEmail').value = '';
    document.getElementById('signupPassword').value = '';
}
function getErrorMessage(errorCode) {
    switch (errorCode) {
        case 'auth/user-not-found': return '등록되지 않은 이메일입니다.';
        case 'auth/wrong-password': return '잘못된 비밀번호입니다.';
        case 'auth/email-already-in-use': return '이미 사용 중인 이메일입니다.';
        default: return '오류가 발생했습니다. 다시 시도해주세요.';
    }
}

// 페이지 로드 시 디버깅을 위한 테스트 함수
function testQnALoading() {
    console.log('Q&A 로딩 테스트 시작');
    console.log('현재 사용자:', currentUser);
    console.log('사용자 타입:', currentUserType);
    
    if (currentUser) {
        loadQnA();
    } else {
        console.log('사용자가 로그인하지 않음');
    }
}

// PWA 관련
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
        navigator.serviceWorker.register('sw.js').then(function(registration) {
            console.log('ServiceWorker registration successful');
        }, function(err) {
            console.log('ServiceWorker registration failed: ', err);
        });
    });
}

// =============================================
// ### 보호자 전용 기능들 ###
// =============================================

// 보호자 데이터 로드
async function loadGuardianData() {
    try {
        const userSnapshot = await database.ref(`users/${currentUser.uid}`).once('value');
        const userData = userSnapshot.val();
        
        if (userData) {
            document.getElementById('guardianName').textContent = userData.name;
            
            // 인증 상태 확인
            const verificationSnapshot = await database.ref(`guardianVerifications/${currentUser.uid}`).once('value');
            const verificationData = verificationSnapshot.val() || {};
            
            updateVerificationStatus(verificationData);
            loadGuardianNotifications();
        }
    } catch (error) {
        console.error('보호자 데이터 로드 오류:', error);
    }
}

// 인증 상태 업데이트
function updateVerificationStatus(verificationData) {
    const statusCard = document.getElementById('verificationStatusCard');
    const statusText = document.getElementById('verificationStatusText');
    
    const verifiedPatients = Object.values(verificationData).filter(v => v.status === 'verified');
    
    if (verifiedPatients.length > 0) {
        statusCard.className = 'verification-status verified';
        statusText.textContent = `✅ ${verifiedPatients.length}명의 피보호자 인증이 완료되었습니다`;
        isGuardianVerified = true;
        guardianManagedPatients = verifiedPatients;
    } else {
        const pendingPatients = Object.values(verificationData).filter(v => v.status === 'pending');
        if (pendingPatients.length > 0) {
            statusCard.className = 'verification-status pending';
            statusText.textContent = '⏳ 인증 처리 중입니다 (영업일 기준 1-2일 소요)';
            isGuardianVerified = false;
        } else {
            statusCard.className = 'verification-status';
            statusText.textContent = '❗ 인증을 위해 가족관계증명서를 업로드해주세요';
            isGuardianVerified = false;
        }
    }
}

// 보호자 알림 로드
async function loadGuardianNotifications() {
    const notificationEl = document.getElementById('guardianNotifications');
    if (!notificationEl) return;
    
    try {
        if (isGuardianVerified && guardianManagedPatients.length > 0) {
            notificationEl.innerHTML = `<div style="font-size: 12px; color: #28a745;">📋 ${guardianManagedPatients.length}명의 피보호자를 관리 중입니다</div>`;
        } else {
            notificationEl.innerHTML = '<div style="font-size: 12px; color: #ffc107;">⚠️ 가족관계 인증을 완료하여 피보호자를 관리해보세요</div>';
        }
    } catch (error) {
        console.error('보호자 알림 로드 오류:', error);
    }
}

// 인증 확인 후 네비게이션
function checkVerificationAndNavigate(screenId) {
    if (!isGuardianVerified) {
        alert('가족관계 인증이 필요합니다. 먼저 가족관계증명서를 업로드해주세요.');
        showScreen('familyVerificationScreen');
        return;
    }
    showScreen(screenId);
}

// 보호자용 환자 검색
async function searchPatientsForVerification(query) {
    const resultsDiv = document.getElementById('patientSearchResults');
    
    if (!query.trim()) {
        resultsDiv.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">환자 이름 또는 이메일을 입력하세요.</p>';
        return;
    }
    
    if (query.length < 2) {
        resultsDiv.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">2글자 이상 입력해주세요.</p>';
        return;
    }
    
    try {
        resultsDiv.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">검색 중...</p>';
        
        // 실제 Firebase에서 환자 검색 (의사 탭 검색과 동일한 방식)
        const usersSnapshot = await database.ref('users').orderByChild('userType').equalTo('patient').once('value');
        const allPatients = usersSnapshot.val() || {};
        
        // 이미 인증된 환자 목록 가져오기
        const verificationSnapshot = await database.ref(`guardianVerifications/${currentUser.uid}`).once('value');
        const alreadyVerifiedPatients = Object.keys(verificationSnapshot.val() || {});
        
        const searchResults = Object.entries(allPatients).filter(([patientId, patient]) => {
            const nameMatch = patient.name.toLowerCase().includes(query.toLowerCase());
            const emailMatch = patient.email.toLowerCase().includes(query.toLowerCase());
            const notAlreadyVerified = !alreadyVerifiedPatients.includes(patientId);
            
            return (nameMatch || emailMatch) && notAlreadyVerified;
        });
        
        if (searchResults.length === 0) {
            resultsDiv.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">검색 결과가 없습니다.</p>';
            return;
        }
        
        resultsDiv.innerHTML = '';
        searchResults.forEach(([patientId, patient]) => {
            const resultCard = document.createElement('div');
            resultCard.style.cssText = `
                border: 1px solid #e0e0e0;
                border-radius: 8px;
                padding: 12px;
                margin-bottom: 10px;
                cursor: pointer;
                transition: all 0.2s ease;
                background: white;
            `;
            
            resultCard.addEventListener('mouseenter', function() {
                this.style.backgroundColor = '#f0f8ff';
                this.style.borderColor = '#2175f4';
            });
            resultCard.addEventListener('mouseleave', function() {
                this.style.backgroundColor = 'white';
                this.style.borderColor = '#e0e0e0';
            });
            
            resultCard.innerHTML = `
                <div style="font-weight: bold; margin-bottom: 5px;">👤 ${patient.name}</div>
                <div style="font-size: 14px; color: #666;">📧 ${patient.email}</div>
            `;
            
            resultCard.onclick = () => selectPatientForVerification({
                id: patientId,
                name: patient.name,
                email: patient.email
            });
            resultsDiv.appendChild(resultCard);
        });
        
    } catch (error) {
        console.error('환자 검색 오류:', error);
        resultsDiv.innerHTML = '<p style="text-align: center; color: #dc3545; padding: 20px;">검색 중 오류가 발생했습니다.</p>';
    }
}

// 환자 선택
function selectPatientForVerification(patient) {
    selectedPatientForVerification = patient;
    
    // 기존 검색 결과에서 선택된 카드 하이라이트
    const allCards = document.querySelectorAll('.search-result-card');
    allCards.forEach(card => card.classList.remove('selected'));
    
    // 선택된 환자 카드 표시
    const selectedCard = document.getElementById('selectedPatientCard');
    selectedCard.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
                <div style="font-weight: bold; font-size: 16px; margin-bottom: 5px;">👤 ${patient.name}</div>
                <div style="color: #666; font-size: 14px;">📧 ${patient.email}</div>
            </div>
            <div style="color: #28a745; font-size: 18px;">✓</div>
        </div>
    `;
    
    // 단계별 표시
    document.getElementById('selectedPatientStep').style.display = 'block';
    document.getElementById('relationshipStep').style.display = 'block';
    
    // 검색 결과 영역 업데이트
    document.getElementById('patientSearchResults').innerHTML = `
        <div style="text-align: center; color: #28a745; padding: 20px; background: #f8fff8; border: 1px solid #28a745; border-radius: 5px; margin: 8px;">
            ✅ ${patient.name} 환자가 선택되었습니다
        </div>
    `;
    
    // 관계 선택 이벤트 리스너
    document.getElementById('selectedRelationshipType').onchange = function() {
        if (this.value) {
            document.getElementById('documentUploadStep').style.display = 'block';
            document.getElementById('uploadBtn').style.display = 'block';
        }
    };
}

// 가족관계증명서 업로드
async function uploadFamilyDocument() {
    if (!selectedPatientForVerification) {
        alert('먼저 피보호자를 선택해주세요.');
        return;
    }
    
    const relationshipType = document.getElementById('selectedRelationshipType').value;
    if (!relationshipType) {
        alert('가족관계를 선택해주세요.');
        return;
    }
    
    const fileInput = document.getElementById('familyDocumentFile');
    const note = document.getElementById('verificationNote').value.trim();
    
    if (!fileInput.files[0]) {
        alert('가족관계증명서 파일을 선택해주세요.');
        return;
    }
    
    const file = fileInput.files[0];
    
    if (file.type !== 'application/pdf') {
        alert('PDF 파일만 업로드 가능합니다.');
        return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
        alert('파일 크기는 5MB 이하여야 합니다.');
        return;
    }
    
    try {
        showLoading(true);
        
        const verificationData = {
            status: 'verified', // 시연용으로 바로 인증 완료
            patientId: selectedPatientForVerification.id,
            patientName: selectedPatientForVerification.name,
            patientEmail: selectedPatientForVerification.email,
            relationshipType: relationshipType,
            fileName: file.name,
            note: note,
            uploadedAt: firebase.database.ServerValue.TIMESTAMP,
            guardianId: currentUser.uid
        };
        
        await database.ref(`guardianVerifications/${currentUser.uid}/${selectedPatientForVerification.id}`).set(verificationData);
        
        alert(`${selectedPatientForVerification.name} 환자와의 가족관계 인증이 완료되었습니다!\n관계: ${getRelationshipText(relationshipType)}`);
        
        isGuardianVerified = true;
        const verificationObj = {};
        verificationObj[selectedPatientForVerification.id] = verificationData;
        updateVerificationStatus(verificationObj);
        
        resetVerificationForm();
        showScreen('guardianDashboard');
        
    } catch (error) {
        console.error('업로드 오류:', error);
        alert('업로드 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
        showLoading(false);
    }
}

// 관계 텍스트 변환
function getRelationshipText(relationshipType) {
    const relationships = {
        'parent': '부모', 'spouse': '배우자', 'child': '자녀',
        'sibling': '형제/자매', 'relative': '친척', 'caregiver': '간병인', 'other': '기타'
    };
    return relationships[relationshipType] || relationshipType;
}

// 인증 폼 초기화
function resetVerificationForm() {
    selectedPatientForVerification = null;
    document.getElementById('patientSearchInput').value = '';
    document.getElementById('patientSearchResults').innerHTML = '';
    document.getElementById('selectedPatientStep').style.display = 'none';
    document.getElementById('relationshipStep').style.display = 'none';
    document.getElementById('documentUploadStep').style.display = 'none';
    document.getElementById('uploadBtn').style.display = 'none';
    document.getElementById('selectedRelationshipType').value = '';
    document.getElementById('familyDocumentFile').value = '';
    document.getElementById('verificationNote').value = '';
}


async function loadGuardianMedicationScreen() {
    const listEl = document.getElementById('guardianMedicationList');
    if (!listEl) return;
    
    listEl.innerHTML = '<div class="loading" style="text-align: center;">피보호자 복약 현황을 불러오는 중...</div>';
    
    try {
        if (!isGuardianVerified || guardianManagedPatients.length === 0) {
            listEl.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">관리 중인 피보호자가 없습니다.</p>';
            return;
        }
        
        // 오늘 날짜
        const today = new Date().toISOString().split('T')[0];
        
        // 모든 처방전 및 사용자 정보 가져오기
        const prescriptionsSnapshot = await database.ref('prescriptions').once('value');
        const allPrescriptions = prescriptionsSnapshot.val() || {};
        
        const usersSnapshot = await database.ref('users').once('value');
        const users = usersSnapshot.val() || {};
        
        let patientsData = [];
        let sideEffectCount = 0;
        
        // 각 피보호자별 복약 현황 분석
        for (const managedPatient of guardianManagedPatients) {
            const patientId = managedPatient.patientId;
            const patient = users[patientId];
            
            if (!patient || patient.userType !== 'patient') continue;
            
            const patientPrescriptions = allPrescriptions[patientId] || {};
            const activePrescriptions = Object.values(patientPrescriptions).filter(p => 
                p.isActive && today >= p.startDate && today <= p.endDate
            );
            
            if (activePrescriptions.length > 0) {
                // 오늘 복약 기록 확인
                const adherenceSnapshot = await database.ref(`adherence/${patientId}/${today}`).once('value');
                const todayAdherence = adherenceSnapshot.val() || {};
                
                let totalRequired = 0;
                let taken = 0;
                let hasSideEffectToday = false;
                
                activePrescriptions.forEach(prescription => {
                    totalRequired += prescription.times.length;
                    const prescriptionKey = Object.keys(patientPrescriptions).find(key => 
                        patientPrescriptions[key] === prescription
                    );
                    
                    if (todayAdherence[prescriptionKey]) {
                        const adherenceRecord = todayAdherence[prescriptionKey];
                        taken += Object.keys(adherenceRecord).length;
                        
                        // 부작용 확인
                        Object.values(adherenceRecord).forEach(record => {
            if (record.sideEffect === true && !record.sideEffectCleared) {
                hasSideEffectToday = true;
            }
        });
                    }
                });
                
                if (hasSideEffectToday) {
                    sideEffectCount++;
                }
                
                patientsData.push({
                    id: patientId,
                    name: patient.name,
                    relationship: managedPatient.relationshipType,
                    totalRequired,
                    taken,
                    adherenceRate: totalRequired > 0 ? Math.round((taken / totalRequired) * 100) : 0,
                    hasSideEffectToday
                });
            }

            const refreshBtn = document.createElement('button');
    refreshBtn.className = 'btn';
    refreshBtn.style.cssText = 'width: auto; padding: 8px 16px; font-size: 14px; background: #6c757d; margin-top: 15px;';
    refreshBtn.innerHTML = '🔄 상태 새로고침';
    refreshBtn.onclick = loadGuardianMedicationScreen;
    listEl.appendChild(refreshBtn);
        }
        
        // 결과 표시
        listEl.innerHTML = '';
        
        // 알림 카드
        const alertCard = document.createElement('div');
        alertCard.className = 'welcome-card';
        alertCard.style.cssText = 'text-align: left; padding: 20px; margin-bottom: 20px;';
        
        let alertMessage = '📊 오늘의 복약 현황';
        let alertColor = '#28a745';
        
        if (sideEffectCount > 0) {
            alertMessage = `🚨 ${sideEffectCount}명의 피보호자가 부작용을 호소하고 있습니다`;
            alertColor = '#dc3545';
        } else {
            const lowAdherence = patientsData.filter(p => p.adherenceRate < 80);
            if (lowAdherence.length > 0) {
                alertMessage = `⚠️ ${lowAdherence.length}명의 피보호자가 복약 순응도 개선이 필요합니다`;
                alertColor = '#ffc107';
            } else {
                alertMessage = '✅ 모든 피보호자가 양호한 복약 상태를 유지하고 있습니다';
            }
        }
        
        alertCard.style.background = `linear-gradient(135deg, ${alertColor}, ${alertColor}dd)`;
        alertCard.innerHTML = `
            <div style="font-size: 18px; margin-bottom: 10px;">${alertMessage}</div>
            <div style="font-size: 14px;">관리 중인 피보호자: ${patientsData.length}명</div>
        `;
        listEl.appendChild(alertCard);
        
        if (patientsData.length === 0) {
            const noData = document.createElement('div');
            noData.style.cssText = 'text-align: center; color: #666; padding: 20px;';
            noData.textContent = '활성화된 처방전이 있는 피보호자가 없습니다.';
            listEl.appendChild(noData);
            return;
        }
        
        // 부작용 신고가 있는 환자들 먼저 표시
        const sideEffectPatients = patientsData.filter(p => p.hasSideEffectToday);
        const regularPatients = patientsData.filter(p => !p.hasSideEffectToday);
        
        // 부작용 신고 섹션
        if (sideEffectPatients.length > 0) {
            const sideEffectHeader = document.createElement('div');
            sideEffectHeader.style.cssText = `
                background: #dc3545;
                color: white;
                padding: 12px 15px;
                margin-bottom: 15px;
                border-radius: 8px;
                font-weight: bold;
                font-size: 16px;
            `;
            sideEffectHeader.innerHTML = `⚠️ 부작용 호소 피보호자 (${sideEffectPatients.length}명)`;
            listEl.appendChild(sideEffectHeader);
            
            sideEffectPatients.forEach(patient => {
                const patientCard = createGuardianPatientCard(patient, true);
                listEl.appendChild(patientCard);
            });
        }
        
        // 일반 복약 관리 섹션
        if (regularPatients.length > 0) {
            const regularHeader = document.createElement('div');
            regularHeader.style.cssText = `
                background: #f8f9fa;
                color: #333;
                padding: 12px 15px;
                margin: 20px 0 15px 0;
                border-radius: 8px;
                font-weight: bold;
                font-size: 16px;
                border-left: 4px solid #28a745;
            `;
            regularHeader.innerHTML = `📊 일반 복약 관리 (${regularPatients.length}명)`;
            listEl.appendChild(regularHeader);
            
            regularPatients.forEach(patient => {
                const patientCard = createGuardianPatientCard(patient, false);
                listEl.appendChild(patientCard);
            });
        }
        
    } catch (error) {
        console.error('보호자 복약 모니터링 로드 오류:', error);
        listEl.innerHTML = '<p style="text-align: center; color: #dc3545;">복약 현황 로드 중 오류가 발생했습니다.</p>';
    }
}

// 보호자용 환자 카드 생성 함수
function createGuardianPatientCard(patient, hasSideEffect) {
    const patientCard = document.createElement('div');
    patientCard.className = 'patient-card';
    
    if (hasSideEffect) {
        patientCard.style.cssText = `
            border: 2px solid #dc3545;
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 15px;
            background: #fff5f5;
            cursor: pointer;
            transition: all 0.2s;
        `;
        
        patientCard.addEventListener('mouseenter', function() {
            this.style.backgroundColor = '#ffe6e6';
        });
        patientCard.addEventListener('mouseleave', function() {
            this.style.backgroundColor = '#fff5f5';
        });
    } else {
        patientCard.style.cssText = `
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 10px;
            background: white;
            ${patient.adherenceRate < 100 ? 'cursor: pointer; transition: background-color 0.2s;' : ''}
        `;
        
        if (patient.adherenceRate < 100) {
            patientCard.addEventListener('mouseenter', function() {
                this.style.backgroundColor = '#f8f9fa';
            });
            patientCard.addEventListener('mouseleave', function() {
                this.style.backgroundColor = 'white';
            });
        }
    }
    
    let statusColor = '#28a745'; // 녹색
    if (patient.adherenceRate < 50) statusColor = '#dc3545'; // 빨간색
    else if (patient.adherenceRate < 80) statusColor = '#ffc107'; // 노란색
    
    const relationshipText = getRelationshipText(patient.relationship);
    
    patientCard.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <div>
                <div style="font-weight: bold; margin-bottom: 5px; color: ${hasSideEffect ? '#dc3545' : '#333'};">
                    ${hasSideEffect ? '⚠️' : '👤'} ${patient.name} (${relationshipText})
                </div>
                <div style="font-size: 14px; color: #666;">
                    오늘 복약: ${patient.taken}/${patient.totalRequired}회
                    ${hasSideEffect ? ' | 부작용 호소' : ''}
                </div>
            </div>
            <div style="text-align: center;">
                <div style="font-size: 18px; font-weight: bold; color: ${statusColor};">
                    ${patient.adherenceRate}%
                </div>
                <div style="font-size: 12px; color: #666;">순응도</div>
            </div>
        </div>
        ${patient.adherenceRate < 100 || hasSideEffect ? `
            <div style="margin-top: 10px;">
                <button class="btn" style="width: auto; padding: 8px 16px; font-size: 14px; background: ${hasSideEffect ? '#dc3545' : '#28a745'};" onclick="sendGuardianMedicationReminder('${patient.id}', '${patient.name}', ${hasSideEffect})">
                    ${hasSideEffect ? '상태 확인 알림' : '복약 알림'} 보내기
                </button>
            </div>
        ` : ''}
    `;
    
    return patientCard;
}

// 보호자용 복약 알림 전송 함수
async function sendGuardianMedicationReminder(patientId, patientName, hasSideEffect) {
    try {
        showLoading(true);
        
        const timeString = new Date().toLocaleTimeString('ko-KR', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        let reminderMessage;
        if (hasSideEffect) {
            reminderMessage = `💊 건강 상태 확인: 복약 후 부작용이 보고되었습니다. 현재 상태는 어떠신지 보호자에게 알려주시고, 필요시 의료진과 상담받으시기 바랍니다. (${timeString} 보호자 알림)`;
        } else {
            reminderMessage = `💊 복약 알림: 보호자가 복약 현황을 확인했습니다. 처방받은 약을 잊지 말고 복용해주세요. 건강한 회복을 위해 정해진 시간에 복용하는 것이 중요합니다. (${timeString} 보호자 알림)`;
        }
        
        // Firebase에 알림 저장
        await database.ref(`notifications/${patientId}`).push({
            message: reminderMessage,
            read: false,
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            type: hasSideEffect ? 'guardian_side_effect_check' : 'guardian_medication_reminder',
            sentBy: currentUser.uid,
            senderType: 'guardian'
        });
        
        alert(`${patientName} 환자에게 ${hasSideEffect ? '상태 확인' : '복약'} 알림이 전송되었습니다.`);
        
        // 화면 새로고침
        loadGuardianMedicationScreen();
        
    } catch (error) {
        console.error('알림 전송 오류:', error);
        alert('알림 전송 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
        showLoading(false);
    }
}

async function loadGuardianAppointmentScreen() {
    const listEl = document.getElementById('guardianAppointmentList');
    if (!listEl) return;
    
    listEl.innerHTML = '<div class="loading" style="text-align: center;">예약 정보를 불러오는 중...</div>';
    
    try {
        if (!isGuardianVerified || guardianManagedPatients.length === 0) {
            listEl.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">관리 중인 피보호자가 없습니다.</p>';
            return;
        }
        
        listEl.innerHTML = `
            <div class="welcome-card" style="text-align: left; padding: 20px; margin-bottom: 20px;">
                <div style="font-size: 18px; margin-bottom: 10px;">📅 대리 예약 서비스</div>
                <div style="font-size: 14px;">피보호자를 대신하여 진료 예약을 관리할 수 있습니다.</div>
            </div>
            
            <!-- 1단계: 피보호자 선택 -->
            <div class="form-group">
                <label>1단계: 예약할 피보호자 선택</label>
                <select id="selectedPatientForAppt" style="width: 100%; padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px;" onchange="showAppointmentForm()">
                    <option value="">피보호자를 선택하세요</option>
                    ${guardianManagedPatients.map(patient => 
                        `<option value="${patient.patientId}">${patient.patientName} (${getRelationshipText(patient.relationshipType)})</option>`
                    ).join('')}
                </select>
            </div>
            
            <!-- 2단계: 예약 폼 (처음에는 숨김) -->
            <div id="appointmentFormSection" style="display: none;">
                <div class="calendar-container">
                    <h3>2단계: 날짜 선택</h3>
                    <input type="date" id="guardianAppointmentDate" class="form-group" style="width: 100%; padding: 10px; margin: 10px 0;" onchange="updateAvailableSlots()">
                    
                    <h3>3단계: 시간 선택</h3>
                    <div class="time-slots" id="guardianTimeSlots">
                        <div class="time-slot" onclick="selectGuardianTimeSlot(this, '09:00')">09:00</div>
                        <div class="time-slot" onclick="selectGuardianTimeSlot(this, '09:30')">09:30</div>
                        <div class="time-slot" onclick="selectGuardianTimeSlot(this, '10:00')">10:00</div>
                        <div class="time-slot" onclick="selectGuardianTimeSlot(this, '10:30')">10:30</div>
                        <div class="time-slot" onclick="selectGuardianTimeSlot(this, '11:00')">11:00</div>
                        <div class="time-slot" onclick="selectGuardianTimeSlot(this, '11:30')">11:30</div>
                        <div class="time-slot" onclick="selectGuardianTimeSlot(this, '14:00')">14:00</div>
                        <div class="time-slot" onclick="selectGuardianTimeSlot(this, '14:30')">14:30</div>
                        <div class="time-slot" onclick="selectGuardianTimeSlot(this, '15:00')">15:00</div>
                        <div class="time-slot" onclick="selectGuardianTimeSlot(this, '15:30')">15:30</div>
                        <div class="time-slot" onclick="selectGuardianTimeSlot(this, '16:00')">16:00</div>
                        <div class="time-slot" onclick="selectGuardianTimeSlot(this, '16:30')">16:30</div>
                        <div class="time-slot" onclick="selectGuardianTimeSlot(this, '17:00')">17:00</div>
                        <div class="time-slot" onclick="selectGuardianTimeSlot(this, '17:30')">17:30</div>
                        <div class="time-slot" onclick="selectGuardianTimeSlot(this, '18:00')">18:00</div>
                    </div>
                    
                    <button class="btn" onclick="makeGuardianAppointment()" style="margin-top: 20px;" id="guardianApptBtn" disabled>예약하기</button>
                </div>
            </div>
            
            <h3 style="margin-top: 30px; margin-bottom: 15px;">📋 기존 예약 현황</h3>
            <div id="existingAppointments">
                <div style="text-align: center; color: #666; padding: 20px;">예약 목록을 불러오는 중...</div>
            </div>
        `;
        
        // 기존 예약 목록 로드
        loadExistingGuardianAppointments();
        
    } catch (error) {
        console.error('대리 예약 화면 로드 오류:', error);
        listEl.innerHTML = '<p style="text-align: center; color: #dc3545;">예약 화면 로드 중 오류가 발생했습니다.</p>';
    }
}

async function loadGuardianRecordsScreen() {
    const listEl = document.getElementById('guardianRecordsList');
    if (!listEl) return;
    
    listEl.innerHTML = '<div class="loading" style="text-align: center;">진료기록을 불러오는 중...</div>';
    
    try {
        if (!isGuardianVerified || guardianManagedPatients.length === 0) {
            listEl.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">관리 중인 피보호자가 없습니다.</p>';
            return;
        }
        
        listEl.innerHTML = `
            <div class="welcome-card" style="text-align: left; padding: 20px; margin-bottom: 20px;">
                <div style="font-size: 18px; margin-bottom: 10px;">📋 피보호자 진료기록부</div>
                <div style="font-size: 14px;">인증된 피보호자의 진료기록을 열람하고 다운로드할 수 있습니다.</div>
            </div>
        `;
        
        // 각 피보호자별로 진료기록 표시
        for (const managedPatient of guardianManagedPatients) {
            const patientId = managedPatient.patientId;
            const patientName = managedPatient.patientName;
            const relationship = getRelationshipText(managedPatient.relationshipType);
            
            // 해당 환자의 진료기록 가져오기
            const recordsSnapshot = await database.ref(`medicalRecords/${patientId}`)
                .orderByChild('uploadedAt')
                .once('value');
            const patientRecords = recordsSnapshot.val() || {};
            
            // 환자별 섹션 헤더
            const patientSection = document.createElement('div');
            patientSection.style.cssText = `
                background: #f8f9fa;
                padding: 12px 15px;
                margin: 20px 0 15px 0;
                border-radius: 8px;
                border-left: 4px solid #28a745;
                font-weight: bold;
                font-size: 16px;
            `;
            patientSection.innerHTML = `👤 ${patientName} (${relationship})`;
            listEl.appendChild(patientSection);
            
            if (Object.keys(patientRecords).length === 0) {
                const noRecords = document.createElement('div');
                noRecords.style.cssText = `
                    text-align: center;
                    color: #666;
                    padding: 20px;
                    background: white;
                    border: 1px solid #e0e0e0;
                    border-radius: 8px;
                    margin-bottom: 15px;
                `;
                noRecords.textContent = '등록된 진료기록부가 없습니다.';
                listEl.appendChild(noRecords);
                continue;
            }
            
            // 최신순으로 정렬
            const sortedRecords = Object.entries(patientRecords).sort(([,a], [,b]) => b.uploadedAt - a.uploadedAt);
            
            for (const [recordId, record] of sortedRecords) {
                const recordCard = document.createElement('div');
                recordCard.className = 'record-card patient-card';
                recordCard.style.cssText = `
                    border: 1px solid #e0e0e0;
                    border-radius: 8px;
                    padding: 15px;
                    margin-bottom: 15px;
                    background: white;
                    transition: all 0.2s ease;
                `;
                
                recordCard.addEventListener('mouseenter', function() {
                    this.style.transform = 'translateY(-2px)';
                    this.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.1)';
                });
                recordCard.addEventListener('mouseleave', function() {
                    this.style.transform = 'translateY(0)';
                    this.style.boxShadow = 'none';
                });
                
                const uploadDate = new Date(record.uploadedAt).toLocaleDateString();
                const fileSize = (record.fileSize / 1024 / 1024).toFixed(2);
                
                recordCard.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="flex: 1;">
                            <div style="font-weight: bold; margin-bottom: 5px; color: #333;">
                                📄 ${record.title}
                            </div>
                            <div style="font-size: 14px; color: #666; margin-bottom: 5px;">
                                업로드일: ${uploadDate} | 파일크기: ${fileSize}MB
                            </div>
                            <div style="font-size: 12px; color: #888;">
                                환자: ${patientName}
                            </div>
                            ${record.description ? `
                                <div style="font-size: 13px; color: #555; margin-top: 8px; padding: 8px; background: #f8f9fa; border-radius: 4px;">
                                    ${record.description}
                                </div>
                            ` : ''}
                        </div>
                        <div style="text-align: center; margin-left: 15px;">
                            <button class="btn" style="width: auto; padding: 8px 16px; font-size: 14px; background: #28a745;" onclick="downloadGuardianMedicalRecord('${record.downloadURL}', '${record.fileName}', '${patientName}', '${record.title}')">
                                📥 다운로드
                            </button>
                            <div style="font-size: 11px; color: #666; margin-top: 5px;">
                                보호자 열람
                            </div>
                        </div>
                    </div>
                `;
                
                listEl.appendChild(recordCard);
            }
        }
        
        // 총 기록 수 표시
        const totalRecordsCount = guardianManagedPatients.reduce((total, patient) => {
            // 각 환자의 기록 수를 계산하여 합산하는 로직은 이미 위에서 처리됨
            return total;
        }, 0);
        
    } catch (error) {
        console.error('보호자 진료기록 로드 오류:', error);
        listEl.innerHTML = '<p style="text-align: center; color: #dc3545;">진료기록 로드 중 오류가 발생했습니다.</p>';
    }
}

// 보호자용 진료기록부 다운로드 함수
function downloadGuardianMedicalRecord(downloadURL, fileName, patientName, recordTitle) {
    try {
        // 다운로드 로그 기록 (선택사항)
        logGuardianDownload(patientName, recordTitle);
        
        // 파일 다운로드 실행
        const link = document.createElement('a');
        link.href = downloadURL;
        link.download = `[${patientName}]_${fileName}`;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // 성공 메시지
        showTemporaryMessage(`${patientName}의 "${recordTitle}" 기록이 다운로드되었습니다.`);
        
    } catch (error) {
        console.error('다운로드 오류:', error);
        alert('파일 다운로드 중 오류가 발생했습니다.');
    }
}

// 보호자 다운로드 로그 기록 (선택사항)
async function logGuardianDownload(patientName, recordTitle) {
    try {
        const logData = {
            guardianId: currentUser.uid,
            guardianName: document.getElementById('guardianName').textContent,
            patientName: patientName,
            recordTitle: recordTitle,
            downloadedAt: firebase.database.ServerValue.TIMESTAMP,
            action: 'guardian_download_medical_record'
        };
        
        // 다운로드 로그를 별도 테이블에 저장 (감사 목적)
        await database.ref('guardianDownloadLogs').push(logData);
        
    } catch (error) {
        console.error('다운로드 로그 기록 오류:', error);
        // 로그 기록 실패해도 다운로드는 계속 진행
    }
}

// 임시 메시지 표시 함수
function showTemporaryMessage(message) {
    const messageDiv = document.createElement('div');
    messageDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #28a745;
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 1000;
        font-size: 14px;
        max-width: 300px;
    `;
    messageDiv.textContent = message;
    
    document.body.appendChild(messageDiv);
    
    // 3초 후 제거
    setTimeout(() => {
        if (document.body.contains(messageDiv)) {
            document.body.removeChild(messageDiv);
        }
    }, 3000);
}

// 보호자 예약 관련 전역 변수
let selectedGuardianTimeSlot = null;
let selectedPatientForAppointment = null;

// 예약 폼 표시
function showAppointmentForm() {
    const patientSelect = document.getElementById('selectedPatientForAppt');
    const formSection = document.getElementById('appointmentFormSection');
    
    if (patientSelect.value) {
        selectedPatientForAppointment = {
            id: patientSelect.value,
            name: patientSelect.options[patientSelect.selectedIndex].text.split(' (')[0]
        };
        formSection.style.display = 'block';
        
        // 오늘 날짜 이후로 설정
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        document.getElementById('guardianAppointmentDate').min = tomorrow.toISOString().split('T')[0];
    } else {
        formSection.style.display = 'none';
        selectedPatientForAppointment = null;
    }
}

// 보호자용 시간 슬롯 선택
function selectGuardianTimeSlot(element, time) {
    document.querySelectorAll('#guardianTimeSlots .time-slot').forEach(slot => {
        slot.classList.remove('selected');
    });
    element.classList.add('selected');
    selectedGuardianTimeSlot = time;
    
    // 예약 버튼 활성화
    document.getElementById('guardianApptBtn').disabled = false;
}

// 사용 가능한 시간 슬롯 업데이트
async function updateAvailableSlots() {
    const selectedDate = document.getElementById('guardianAppointmentDate').value;
    if (!selectedDate) return;
    
    try {
        // 해당 날짜의 기존 예약 확인
        const appointmentsSnapshot = await database.ref('appointments')
            .orderByChild('date')
            .equalTo(selectedDate)
            .once('value');
        
        const existingAppointments = appointmentsSnapshot.val() || {};
        const bookedTimes = Object.values(existingAppointments).map(apt => apt.time);
        
        // 시간 슬롯 업데이트
        document.querySelectorAll('#guardianTimeSlots .time-slot').forEach(slot => {
            const time = slot.textContent;
            if (bookedTimes.includes(time)) {
                slot.classList.add('disabled');
                slot.onclick = null;
            } else {
                slot.classList.remove('disabled');
                slot.onclick = () => selectGuardianTimeSlot(slot, time);
            }
        });
        
    } catch (error) {
        console.error('시간 슬롯 업데이트 오류:', error);
    }
}

// 보호자 대리 예약 실행
async function makeGuardianAppointment() {
    const date = document.getElementById('guardianAppointmentDate').value;
    
    if (!date || !selectedGuardianTimeSlot || !selectedPatientForAppointment) {
        alert('모든 항목을 선택해주세요.');
        return;
    }
    
    try {
        showLoading(true);
        
        const appointmentData = {
            patientId: selectedPatientForAppointment.id,
            patientName: selectedPatientForAppointment.name,
            guardianId: currentUser.uid,
            guardianName: document.getElementById('guardianName').textContent,
            date: date,
            time: selectedGuardianTimeSlot,
            status: 'scheduled',
            type: 'guardian_booking',
            createdAt: firebase.database.ServerValue.TIMESTAMP
        };
        
        await database.ref('appointments').push(appointmentData);
        
        // 환자에게 알림 전송
        const notificationMessage = `📅 진료 예약 안내: 보호자가 ${date} ${selectedGuardianTimeSlot}에 진료 예약을 완료했습니다.`;
        await database.ref(`notifications/${selectedPatientForAppointment.id}`).push({
            message: notificationMessage,
            read: false,
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            type: 'guardian_appointment',
            guardianId: currentUser.uid
        });
        
        alert(`${selectedPatientForAppointment.name} 환자의 진료 예약이 완료되었습니다.\n날짜: ${date}\n시간: ${selectedGuardianTimeSlot}`);
        
        // 폼 리셋
        resetGuardianAppointmentForm();
        
        // 기존 예약 목록 새로고침
        loadExistingGuardianAppointments();
        
    } catch (error) {
        console.error('예약 오류:', error);
        alert('예약 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
        showLoading(false);
    }
}

// 보호자 예약 폼 리셋
function resetGuardianAppointmentForm() {
    document.getElementById('selectedPatientForAppt').value = '';
    document.getElementById('guardianAppointmentDate').value = '';
    document.getElementById('appointmentFormSection').style.display = 'none';
    document.querySelectorAll('#guardianTimeSlots .time-slot').forEach(slot => {
        slot.classList.remove('selected');
    });
    selectedGuardianTimeSlot = null;
    selectedPatientForAppointment = null;
    document.getElementById('guardianApptBtn').disabled = true;
}

// 기존 예약 목록 로드
async function loadExistingGuardianAppointments() {
    const appointmentsDiv = document.getElementById('existingAppointments');
    if (!appointmentsDiv) return;
    
    try {
        // 보호자가 만든 예약들 가져오기
        const appointmentsSnapshot = await database.ref('appointments')
            .orderByChild('guardianId')
            .equalTo(currentUser.uid)
            .once('value');
        
        const appointments = appointmentsSnapshot.val() || {};
        
        appointmentsDiv.innerHTML = '';
        
        if (Object.keys(appointments).length === 0) {
            appointmentsDiv.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">예약된 진료가 없습니다.</p>';
            return;
        }
        
        // 날짜순 정렬
        const sortedAppointments = Object.entries(appointments).sort(([,a], [,b]) => {
            const dateA = new Date(a.date + ' ' + a.time);
            const dateB = new Date(b.date + ' ' + b.time);
            return dateA - dateB;
        });
        
        sortedAppointments.forEach(([appointmentId, appointment]) => {
            const appointmentCard = document.createElement('div');
            appointmentCard.className = 'appointment-card';
            
            const appointmentDate = new Date(appointment.date);
            const isToday = appointment.date === new Date().toISOString().split('T')[0];
            const isPast = new Date(appointment.date + ' ' + appointment.time) < new Date();
            
            appointmentCard.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div class="appointment-time" style="color: ${isPast ? '#999' : '#2175f4'};">
                            ${appointmentDate.getMonth() + 1}월 ${appointmentDate.getDate()}일 ${appointment.time}
                            ${isToday ? '(오늘)' : ''}
                        </div>
                        <div style="font-weight: bold; margin: 5px 0;">
                            👤 ${appointment.patientName}
                        </div>
                        <div style="font-size: 14px; color: #666;">
                            예약자: 보호자 (${document.getElementById('guardianName').textContent})
                        </div>
                    </div>
                    <div style="text-align: center;">
                        ${!isPast ? `
                            <button class="btn" style="width: auto; padding: 6px 12px; font-size: 12px; background: #dc3545;" onclick="cancelGuardianAppointment('${appointmentId}', '${appointment.patientName}', '${appointment.date}', '${appointment.time}')">
                                예약 취소
                            </button>
                        ` : `
                            <span style="color: #999; font-size: 12px;">완료</span>
                        `}
                    </div>
                </div>
            `;
            
            appointmentsDiv.appendChild(appointmentCard);
        });
        
    } catch (error) {
        console.error('기존 예약 로드 오류:', error);
        appointmentsDiv.innerHTML = '<p style="text-align: center; color: #dc3545;">예약 목록 로드 중 오류가 발생했습니다.</p>';
    }
}

// 보호자 예약 취소
async function cancelGuardianAppointment(appointmentId, patientName, date, time) {
    if (!confirm(`${patientName} 환자의 ${date} ${time} 예약을 취소하시겠습니까?`)) {
        return;
    }
    
    try {
        showLoading(true);
        
        // 예약 삭제
        await database.ref(`appointments/${appointmentId}`).remove();
        
        // 환자에게 취소 알림
        const patientId = guardianManagedPatients.find(p => p.patientName === patientName)?.patientId;
        if (patientId) {
            await database.ref(`notifications/${patientId}`).push({
                message: `📅 예약 취소 안내: ${date} ${time} 진료 예약이 보호자에 의해 취소되었습니다.`,
                read: false,
                timestamp: firebase.database.ServerValue.TIMESTAMP,
                type: 'appointment_cancelled'
            });
        }
        
        alert('예약이 취소되었습니다.');
        
        // 목록 새로고침
        loadExistingGuardianAppointments();
        
    } catch (error) {
        console.error('예약 취소 오류:', error);
        alert('예약 취소 중 오류가 발생했습니다.');
    } finally {
        showLoading(false);
    }
}

// 부작용 상태 해제 함수
async function clearSideEffectStatus() {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        // 오늘의 복약 기록에서 부작용 상태 해제
        const adherenceSnapshot = await database.ref(`adherence/${currentUser.uid}/${today}`).once('value');
        const todayAdherence = adherenceSnapshot.val() || {};
        
        // 모든 처방전의 모든 시간대에서 부작용 상태 해제
        for (const prescriptionId in todayAdherence) {
            for (const timeSlot in todayAdherence[prescriptionId]) {
                if (todayAdherence[prescriptionId][timeSlot].sideEffect === true) {
                    await database.ref(`adherence/${currentUser.uid}/${today}/${prescriptionId}/${timeSlot}`).update({
                        sideEffect: false,
                        sideEffectCleared: true,
                        sideEffectClearedAt: firebase.database.ServerValue.TIMESTAMP,
                        clearedByGuardianAlert: true
                    });
                }
            }
        }
        
        console.log('부작용 상태가 해제되었습니다.');
        
    } catch (error) {
        console.error('부작용 상태 해제 오류:', error);
    }
}
