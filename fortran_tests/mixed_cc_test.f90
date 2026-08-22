program cc_test
  use, intrinsic :: iso_c_binding, only: c_int
  implicit none

  interface
    function add_one(x) bind(C, name="add_one")
      use, intrinsic :: iso_c_binding, only: c_int
      implicit none

      integer(c_int), value :: x
      integer(c_int) :: add_one
    end function add_one
  end interface

  integer(c_int) :: result

  result = add_one(41)

  if (result == 42) then
    print *, "Mixed C/Fortran compile/link: OK"
  else
    print *, "Mixed C/Fortran compile/link: FAILED"
    stop 1
  end if

end program cc_test
