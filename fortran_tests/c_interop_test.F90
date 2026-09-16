#define SUCCESS_CODE 0

program interop_test
    use iso_c_binding, only: c_int, c_float
    implicit none

#ifdef SUCCESS_CODE
    integer :: status = SUCCESS_CODE
#else
    integer :: status = -1
#endif

    integer(c_int) :: i = 42_c_int
    real(c_float) :: x = 3.14_c_float

    print *, "CPP status:", status
    print *, "C-compatible Int:", i
    print *, "C-compatible Float:", x

    if (status /= 0) then
        print *, "Preprocessor Test: FAILED"
        stop 5
    end if

    print *, "Interoperability & CPP: OK"
end
